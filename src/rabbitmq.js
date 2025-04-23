const amqp = require('amqplib/callback_api');
require('dotenv').config();

const RabbitMQIP = process.env.RABBITMQ_IP;
const RabbitMQQueueName = process.env.RABBITMQ_QUEUE_NAME;
const RabbitMQDurable = process.env.RABBITMQ_DURABLE === 'true';
const RabbitMQUsername = process.env.RABBITMQ_USERNAME;
const RabbitMQPassword = process.env.RABBITMQ_PASSWORD;

const RabbitMQDLX = process.env.RABBITMQ_DLX || 'dlx';
const RabbitMQDLQ = process.env.RABBITMQ_DLQ || 'dlq';
const RabbitMQDLXRoutingKey = process.env.RABBITMQ_DLX_ROUTING_KEY || 'dlx-routing-key';

let rabbitmqChannel = null;
let rabbitmqConnection = null;

function connectToRabbitMQ(callback) {
    console.log("Connecting to RabbitMQ...");

    amqp.connect(`amqp://${RabbitMQUsername}:${RabbitMQPassword}@${RabbitMQIP}`, (error, connection) => {
        if (error) {
            console.error("RabbitMQ Connection Error:", error.message);
            setTimeout(() => connectToRabbitMQ(callback), 5000);
            return;
        }

        console.log("RabbitMQ Connection Established");

        connection.on("error", err => {
            console.error("RabbitMQ Connection Error:", err.message);
            if (err.message !== "Connection closing") {
                setTimeout(() => connectToRabbitMQ(callback), 5000);
            }
        });

        connection.on("close", () => {
            console.warn("RabbitMQ Connection Closed. Reconnecting...");
            setTimeout(() => connectToRabbitMQ(callback), 5000);
        });

        console.log("Calling createChannel...");
        connection.createChannel((error, channel) => {
            if (error) {
                console.error("RabbitMQ Channel Creation Error:", error.message);
                return;
            }

            console.log("RabbitMQ Channel Created");

            // Dead Letter Exchange and Queue setup 
            channel.assertExchange(RabbitMQDLX, 'direct', { durable: true });
            channel.assertQueue(RabbitMQDLQ, { durable: true });
            channel.bindQueue(RabbitMQDLQ, RabbitMQDLX, RabbitMQDLXRoutingKey);

            // Main queue with DLX configuration
            channel.assertQueue(RabbitMQQueueName, {
                durable: RabbitMQDurable,
                arguments: {
                    'x-dead-letter-exchange': RabbitMQDLX,
                    'x-dead-letter-routing-key': RabbitMQDLXRoutingKey,
                },
            });

            rabbitmqChannel = channel;
            rabbitmqConnection = connection;

            console.log("RabbitMQ Channel Ready");
            callback(null, { channel, connection });
        });
    });
}

async function closeRabbitMQ() {
    if (rabbitmqChannel) await rabbitmqChannel.close();
    if (rabbitmqConnection) await rabbitmqConnection.close();
}

module.exports = {
    connectToRabbitMQ,
    closeRabbitMQ,
    RabbitMQQueueName,
    RabbitMQDurable,
};
