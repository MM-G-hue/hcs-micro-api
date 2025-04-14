const fastify = require('fastify');
const { redisPubSub, redisData, closeRedisConnections, redisApiKeySetName, redisApiKeyChannelName } = require('./redis');
const { connectToRabbitMQ, closeRabbitMQ, RabbitMQQueueName, RabbitMQDurable } = require('./rabbitmq');

require('dotenv').config();
const serverLogging = process.env.SERVER_LOGGING === 'true';
const maxPayload = process.env.MAX_PAYLOAD_LENGTH || 10000;

function buildServer() {
    const app = fastify({ logger: serverLogging });
    let rabbitmqChannel = null;

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

    // Subscribe to Redis Pub/Sub for real-time updates
    redisPubSub.subscribe(redisApiKeyChannelName, (err, count) => {
        if (err) {
            console.error("Error subscribing to Redis channel:", err);
            return;
        }
        console.log(`Subscribed to ${count} Redis pub/sub channel(s)`);
    });

    // Disallow all GET requests
    app.addHook('onRequest', async (request, reply) => {
        if (request.method === 'GET') {
            reply.code(405).type('text/plain').send('Method Not Allowed');
        }
        if (request.headers['content-type'] !== 'text/plain') {
            reply.code(415).type('text/plain').send('Unsupported Media Type');
        }
    });

    // Authentication hook
    app.addHook('preHandler', async (request, reply) => {
        const apiKey = request.headers['x-api-key'];
        if (!apiKey || apiKey.length === 0) {
            reply.code(401).type('text/plain').send('Missing API key');
            return;
        }

        // Check in Redis
        try {
            const existsInRedis = await redisData.sismember(redisApiKeySetName, apiKey);
            if (existsInRedis) {
                return;
            }
        } catch (error) {
            console.error("Redis connection error:", error.message);
            reply.code(500).type('text/plain').send('Redis Connection Error');
        }
 
        reply.code(401).type('text/plain').send('Invalid API key');
    });

    // API endpoint
    app.post('/data', async (request, reply) => {
        if (!rabbitmqChannel) {
            console.error("RabbitMQ Channel is not available");
            reply.code(503).type('text/plain').send('RabbitMQ is not available, try again later');
        }

        if (!request.body) {
            reply.code(400).type('text/plain').send('Message payload is required');
            return;
        }

        // If needed, check for too large payload
        if (request.body.length > maxPayload) {
            reply.code(413).type('text/plain').send('Payload too large');
            return;
        }

        try {
            rabbitmqChannel.sendToQueue(RabbitMQQueueName, Buffer.from(request.body), { persistent: RabbitMQDurable });
            reply.code(200).type('text/plain').send('OK');
        } catch (error) {
            console.error("Failed to send message:", error.message);
            reply.code(500).type('text/plain').send('Failed to send message');
        }
    });

    // Server cleanup
    app.addHook('onClose', async () => {
        await closeRedisConnections();
        await closeRabbitMQ();
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