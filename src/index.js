const fastify = require('fastify');
const { redisPubSub, redisData, refreshApiKeys, closeRedisConnections, redisApiKeySetName, redisApiKeyChannelName } = require('./redis');
const { connectToRabbitMQ, closeRabbitMQ, RabbitMQQueueName, RabbitMQDurable } = require('./rabbitmq');

require('dotenv').config();
const serverLogging = process.env.SERVER_LOGGING === 'true';

function buildServer() {
    const app = fastify({ logger: serverLogging });
    let rabbitmqChannel = null;
    let localApiKeys = new Set();

    function connectRabbitMQ() {
        connectToRabbitMQ((error, result) => {
            if (error) {
                console.error("RabbitMQ Connection Error:", error.message);
                return;
            }
            rabbitmqChannel = result.channel;
            console.log("RabbitMQ Connected");
        });
    }
    connectRabbitMQ();

    // Periodic API key refresh
    const apiKeysRefreshInterval = setInterval(() => refreshApiKeys(localApiKeys), 60000);
    refreshApiKeys(localApiKeys);

    // Subscribe to Redis Pub/Sub for real-time updates
    redisPubSub.subscribe(redisApiKeyChannelName, (err, count) => {
        if (err) {
            console.error("Error subscribing to Redis channel:", err);
            return;
        }
        console.log(`Subscribed to ${count} Redis pub/sub channel(s)`);
    });

    redisPubSub.on('message', (channel, message) => {
        if (channel === redisApiKeyChannelName) {
            const { action, apiKey } = JSON.parse(message);
            if (action === 'add') {
                localApiKeys.add(apiKey);
                console.log(`API key added: ${apiKey}`);
            } else if (action === 'remove') {
                localApiKeys.delete(apiKey);
                console.log(`API key removed: ${apiKey}`);
            }
        }
    });

    // Authentication hook
    app.addHook('preHandler', async (request, reply) => {
        const apiKey = request.headers['x-api-key'];
        if (!apiKey) {
            reply.code(401).send({ message: 'Missing API key' });
            return;
        }

        if (localApiKeys.has(apiKey)) return;

        const existsInRedis = await redisData.sismember(redisApiKeySetName, apiKey);
        if (existsInRedis) {
            localApiKeys.add(apiKey);
            return;
        }

        reply.code(401).send({ message: 'Invalid API key' });
    });

    // API endpoint
    app.post('/message', async (request, reply) => {
        if (!rabbitmqChannel) {
            console.error("RabbitMQ Channel is not available");
            throw { statusCode: 503, message: 'RabbitMQ is not available, try again later' };
        }

        try {
            rabbitmqChannel.sendToQueue(RabbitMQQueueName, Buffer.from(JSON.stringify(request.body)), { persistent: RabbitMQDurable });
            return { status: 'Message sent successfully' };
        } catch (error) {
            console.error("Failed to send message:", error.message);
            throw { statusCode: 500, message: 'Failed to send message' };
        }
    });

    // Server cleanup
    app.addHook('onClose', async () => {
        await closeRedisConnections();
        await closeRabbitMQ();
        clearInterval(apiKeysRefreshInterval);
    });

    return app;
}

// Start the server
const start = async () => {
    const app = buildServer();
    try {
        await app.listen({ port: 3001, host: '0.0.0.0' });
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

start();

module.exports = { buildServer };