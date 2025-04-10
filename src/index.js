const fastify = require('fastify');
const { redisPubSub, redisData, refreshApiKeys, closeRedisConnections, redisApiKeySetName, redisApiKeyChannelName } = require('./redis');
const { connectToRabbitMQ, closeRabbitMQ, RabbitMQQueueName, RabbitMQDurable } = require('./rabbitmq');

require('dotenv').config();
const serverLogging = process.env.SERVER_LOGGING === 'true';
const maxPayload = process.env.MAX_PAYLOAD_LENGTH || 10000;

function buildServer() {
    const app = fastify({ logger: serverLogging });
    let rabbitmqChannel = null;
    const localApiKeys = new Set();

    // The RabbitMQ connection will automatically reconnect on failure
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

    // Live updates from Redis
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

    // Disallow all GET requests
    app.addHook('onRequest', async (request, reply) => {
        if (request.method === 'GET') {
            reply.code(405).send({ message: 'Method Not Allowed' });
        }
        if (request.headers['content-type'] !== 'text/plain') {
            reply.code(415).send({ message: 'Unsupported Media Type' });
        }
    });

    // Authentication hook
    app.addHook('preHandler', async (request, reply) => {
        const apiKey = request.headers['x-api-key'];
        if (!apiKey || apiKey.length === 0) {
            reply.code(401).send({ message: 'Missing API key' });
            return;
        }

        // First, check if key is in the local cache (refreshed every minute)
        if (localApiKeys.has(apiKey)) return;

        // Second, check if key is in Redis
        try {
            const existsInRedis = await redisData.sismember(redisApiKeySetName, apiKey);
            if (existsInRedis) {
                localApiKeys.add(apiKey);
                return;
            }
        } catch (error) {
            console.error("Redis connection error:", error.message);
            reply.code(500).send({ message: 'Redis Connection Error' });
        }
 
        reply.code(401).send({ message: 'Invalid API key' });
    });

    // API endpoint
    app.post('/data', async (request, reply) => {
        if (!rabbitmqChannel) {
            console.error("RabbitMQ Channel is not available");
            reply.code(503).send({ message: 'RabbitMQ is not available, try again later' });
        }

        if (!request.body) {
            reply.code(400).send({ message: 'Message payload is required' });
            return;
        }

        // If needed, check for too large payload
        if (request.body.length > maxPayload) {
            reply.code(413).send({ message: 'Payload too large' });
            return;
        }

        try {
            rabbitmqChannel.sendToQueue(RabbitMQQueueName, Buffer.from(request.body), { persistent: RabbitMQDurable });
            return { status: 'Message sent successfully' };
        } catch (error) {
            console.error("Failed to send message:", error.message);
            reply.code(500).send({ message: 'Failed to send message' });
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