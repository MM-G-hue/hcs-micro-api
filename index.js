const amqp = require('amqplib/callback_api');

require('dotenv').config();
const API_KEYS = [process.env.TEMP_API_KEY]; // Fake API keys
const RabbitMQIP = process.env.RABBITMQ_IP;
const RabbitMQQueueName = process.env.RABBITMQ_QUEUE_NAME;
const RabbitMQDurable = process.env.RABBITMQ_DURABLE;
const RabbitMQUsername = process.env.RABBITMQ_USERNAME;
const RabbitMQPassword = process.env.RABBITMQ_PASSWORD;
const serverLogging = process.env.SERVER_LOGGING == true;

const fastify = require('fastify')({ logger: serverLogging });

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
amqp.connect(`amqp://${RabbitMQUsername}:${RabbitMQPassword}@${RabbitMQIP}`, function (error0, connection) {
    if (error0) throw error0;

    connection.createChannel(function (error1, channel) {
        if (error1) throw error1;
        
        channel.assertQueue(RabbitMQQueueName, {
            durable: RabbitMQDurable
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

    const {message} = request.body;
    
    if (!message) {
        throw { statusCode: 400, message: 'Body is required' };
    }

    try {
        rabbitmqChannel.sendToQueue(RabbitMQQueueName, Buffer.from(message), {persistent: RabbitMQDurable}); // Durable message
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