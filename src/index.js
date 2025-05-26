const fastify = require('fastify');
const { redisPubSub, redisData, closeRedisConnections, redisApiKeySetName, redisApiKeyChannelName, redisAdminKeySetName } = require('./redis');
const { connectToRabbitMQ, closeRabbitMQ, RabbitMQQueueName, RabbitMQDurable } = require('./rabbitmq');

require('dotenv').config();
const serverLogging = process.env.SERVER_LOGGING === 'true';
const maxPayload = process.env.MAX_PAYLOAD_LENGTH || 10000;

function checkQueueAsync(channel, queueName) {
    return new Promise((resolve, reject) => {
        channel.checkQueue(queueName, (err, info) => {
            if (err) return reject(err);
            resolve(info);
        });
    });
}

function buildServer() {
    const app = fastify({ logger: serverLogging });
    let rabbitmqChannel = null;
    let messageCount = 0; // Counter for processed messages
    let errorCount = 0; // Counter for errors

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

    app.addHook('onRequest', async (request, reply) => {
        if (request.method === 'GET') {
            return;
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

        try {
            const isAdminRequest = request.method === 'GET';
            const redisKeySet = isAdminRequest ? redisAdminKeySetName : redisApiKeySetName;

            // Check in Redis
            const existsInRedis = await redisData.sismember(redisKeySet, apiKey);
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
            errorCount++;
            reply.code(503).type('text/plain').send('RabbitMQ is not available, try again later');
            return;
        }

        if (!request.body) {
            errorCount++;
            reply.code(400).type('text/plain').send('Message payload is required');
            return;
        }

        // If needed, check for too large payload
        if (request.body.length > maxPayload) {
            errorCount++;
            reply.code(413).type('text/plain').send('Payload too large');
            return;
        }

        try {
            rabbitmqChannel.sendToQueue(RabbitMQQueueName, Buffer.from(request.body), { persistent: RabbitMQDurable });
            messageCount++;
            reply.code(200).type('text/plain').send('OK');
        } catch (error) {
            console.error("Failed to send message:", error.message);
            errorCount++;
            reply.code(500).type('text/plain').send('Failed to send message');
        }
    });

    // API endpoint for server statistics
    app.get('/stats', async (request, reply) => {
        try {
            // Get RabbitMQ queue depth using promise-based helper
            const queueInfo = await checkQueueAsync(rabbitmqChannel, RabbitMQQueueName);
            const dlqInfo = await checkQueueAsync(rabbitmqChannel, process.env.RABBITMQ_DLQ || 'dlq');

            const stats = {
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
                availableMemory: process.availableMemory(),
                redisConnected: redisData.status === 'ready',
                rabbitMQConnected: !!rabbitmqChannel,
                messagesProcessed: messageCount,
                errors: errorCount,
                queueDepth: queueInfo,
                deadLetterQueueDepth: dlqInfo
            };
            reply.code(200).send(stats);
        } catch (error) {
            console.error("Failed to retrieve server stats:", error.message);
            errorCount++;
            reply.code(500).type('text/plain').send('Failed to retrieve server stats');
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