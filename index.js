const fastify = require('fastify')({ logger: true });
const amqp = require('amqplib/callback_api');

const queueName = 'hello';
const API_KEYS = ['key1', 'key2', 'key3']; // Fake API keys
require('dotenv').config();
const RabbitMQIP = process.env.RABBITMQ_IP;
const username = process.env.RABBITMQ_USERNAME;
const password = process.env.RABBITMQ_PASSWORD;
let rabbitmqChannel = null;

// Authentication hook
fastify.addHook('preHandler', async (request, reply) => {
    const apiKey = request.headers['x-api-key'];
    if (!apiKey || !API_KEYS.includes(apiKey)) {
        throw { statusCode: 401, message: 'Invalid API key' };
    }
});

console.log("Connecting to RabbitMQ at amqp://" + RabbitMQIP);
// Connect to RabbitMQ
amqp.connect(`amqp://${username}:${password}@${RabbitMQIP}`, function (error0, connection) {
    if (error0) throw error0;

    connection.createChannel(function (error1, channel) {
        if (error1) throw error1;
        
        channel.assertQueue(queueName, {
            durable: false
            // durable: true // Durable protects against message loss if RabbitMQ server crashes
        });
        
        rabbitmqChannel = channel;
        fastify.log.info(" [*] RabbitMQ connection established");
    });
});

// API endpoint
fastify.post('/message', async (request, reply) => {
    if (!request.body) {
        throw { statusCode: 400, message: 'Invalid request body' };
    }

    const { message } = request.body;
    
    if (!message) {
        throw { statusCode: 400, message: 'Message is required' };
    }

    try {
        // rabbitmqChannel.sendToQueue(queueName, Buffer.from(message));
        rabbitmqChannel.sendToQueue(queueName, Buffer.from(message), {persistent: true}); // Durable message
        return { status: 'Message sent successfully' };
    } catch (error) {
        throw { statusCode: 500, message: 'Failed to send message' };
    }
});

// Start the server
const start = async () => {
    try {
        await fastify.listen({ port: 3001, host: '0.0.0.0' });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();