const amqp = require('amqplib/callback_api');
const Redis = require('ioredis');

require('dotenv').config();

const RabbitMQIP = process.env.RABBITMQ_IP;
const RabbitMQQueueName = process.env.RABBITMQ_QUEUE_NAME;
const RabbitMQDurable = process.env.RABBITMQ_DURABLE === 'true';
const RabbitMQUsername = process.env.RABBITMQ_USERNAME;
const RabbitMQPassword = process.env.RABBITMQ_PASSWORD;
const serverLogging = process.env.SERVER_LOGGING === 'true';
const redisIP = process.env.REDIS_IP;
const redisPort = process.env.REDIS_PORT;
const redisPassword = process.env.REDIS_PASSWORD;
const redisApiKeySetName = process.env.REDIS_API_KEY_SET_NAME || 'api_keys';
const redisApiKeyChannelName = process.env.REDIS_API_KEY_CHANNEL_NAME || 'api-keys-channel';

const fastify = require('fastify')({ logger: serverLogging });
const redis = new Redis({
    host: redisIP,
    port: redisPort,
    password: redisPassword,
});

let rabbitmqChannel = null;
let rabbitmqConnection = null;
let localApiKeys = new Set();

// Function to create a connection to RabbitMQ with reconnection logic
function connectToRabbitMQ() {
    console.log("Connecting to RabbitMQ...");

    amqp.connect(`amqp://${RabbitMQUsername}:${RabbitMQPassword}@${RabbitMQIP}`, function (error, connection) {
        if (error) {
            console.error("RabbitMQ Connection Error:", error.message);
            setTimeout(connectToRabbitMQ, 5000); // Retry after 5 seconds
            return;
        }

        connection.on("error", err => {
            console.error("RabbitMQ Connection Error:", err.message);
            if (err.message !== "Connection closing") {
                setTimeout(connectToRabbitMQ, 5000); // Retry on unexpected error
            }
        });

        connection.on("close", () => {
            console.warn("RabbitMQ Connection Closed. Reconnecting...");
            setTimeout(connectToRabbitMQ, 5000);
        });

        console.log("Connected to RabbitMQ");

        connection.createChannel(function (error, channel) {
            if (error) {
                console.error("Channel Creation Error:", error.message);
                return;
            }

            channel.on("error", err => {
                console.error("RabbitMQ Channel Error:", err.message);
            });

            channel.on("close", () => {
                console.warn("RabbitMQ Channel Closed. Reconnecting...");
                setTimeout(connectToRabbitMQ, 5000);
            });

            channel.assertQueue(RabbitMQQueueName, { durable: RabbitMQDurable });
            rabbitmqChannel = channel;
            rabbitmqConnection = connection;

            console.log("RabbitMQ Channel Ready");
        });
    });
}

// Call function to establish connection
connectToRabbitMQ();

// Function to fully sync API keys from Redis every x seconds (Failsafe)
async function refreshApiKeys() {
    try {
        console.log("Refreshing API keys from Redis...");
        const keys = await redis.smembers(redisApiKeySetName);  // Get all keys from Redis
        localApiKeys = new Set(keys);  // Replace local cache
        console.log(`Loaded ${keys.length} API keys.`);
    } catch (error) {
        console.error("Error refreshing API keys:", error);
    }
}

// Subscribe to Redis Pub/Sub for real-time updates
redis.subscribe(redisApiKeyChannelName, (err, count) => {
    if (err) {
        console.error("Error subscribing to Redis channel:", err);
        return;
    }
    console.log(`Subscribed to ${count} channel(s)`);
});

// Handle Pub/Sub messages to update local memory in real-time
redis.on('message', (channel, message) => {
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

// Periodically refresh API keys from Redis to ensure consistency (Failsafe)
setInterval(refreshApiKeys, 60000);  // Refresh every 60 seconds
refreshApiKeys();  // Initial full sync

// Authentication hook
fastify.addHook('preHandler', async (request, reply) => {
    const apiKey = request.headers['x-api-key'];
    if (!apiKey) {
        reply.code(401).send({ message: 'Missing API key' });
        return;
    }

    // Check in-memory cache first (fastest)
    if (localApiKeys.has(apiKey)) {
        return;
    }

    // If not found in memory, fallback to Redis (rare case)
    const existsInRedis = await redis.sismember(redisApiKeySetName, apiKey);
    if (existsInRedis) {
        localApiKeys.add(apiKey);  // Re-add to cache
        return;
    }

    reply.code(401).send({ message: 'Invalid API key' });
});

// API endpoint
fastify.post('/message', async (request, reply) => {
    if (!request.body) {
        throw { statusCode: 400, message: 'Invalid request body' };
    }

    const message = request.body;

    if (!rabbitmqChannel) {
        console.error("RabbitMQ Channel is not available");
        throw { statusCode: 503, message: 'RabbitMQ is not available, try again later' };
    }

    try {
        rabbitmqChannel.sendToQueue(RabbitMQQueueName, Buffer.from(message), { persistent: RabbitMQDurable });
        return { status: 'Message sent successfully' };
    } catch (error) {
        console.error("Failed to send message:", error.message);
        throw { statusCode: 500, message: 'Failed to send message' };
    }
});

// Start the server
const start = async () => {
    try {
        await fastify.listen({ port: 3001, host: '0.0.0.0' });
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

start();
