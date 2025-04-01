const amqp = require('amqplib/callback_api');
require('dotenv').config();

const API_KEYS = [process.env.TEMP_API_KEY];
const RabbitMQIP = process.env.RABBITMQ_IP;
const RabbitMQQueueName = process.env.RABBITMQ_QUEUE_NAME;
const RabbitMQDurable = process.env.RABBITMQ_DURABLE === 'true';
const RabbitMQUsername = process.env.RABBITMQ_USERNAME;
const RabbitMQPassword = process.env.RABBITMQ_PASSWORD;
const serverLogging = process.env.SERVER_LOGGING === 'true';

const fastify = require('fastify')({ logger: serverLogging });

let rabbitmqChannel = null;
let rabbitmqConnection = null;

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

// Authentication hook
fastify.addHook('preHandler', async (request, reply) => {
    const apiKey = request.headers['x-api-key'];
    if (!apiKey || !API_KEYS.includes(apiKey)) {
        throw { statusCode: 401, message: 'Invalid API key' };
    }
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
