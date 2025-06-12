const amqp = require('amqplib/callback_api');
require('dotenv').config();

const RabbitMQIP = process.env.RABBITMQ_IP;
const RabbitMQQueueName = process.env.RABBITMQ_QUEUE_NAME;
const RabbitMQDurable = process.env.RABBITMQ_DURABLE === 'true';
const RabbitMQUsername = process.env.RABBITMQ_USERNAME;
const RabbitMQPassword = process.env.RABBITMQ_PASSWORD;
const backoffDelay = process.env.RABBITMQ_BACKOFF_DELAY || 5000;

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
            // If connection fails, retry after x seconds, exponential backoff might be more desirable in the future
            setTimeout(() => connectToRabbitMQ(callback), backoffDelay);
            return;
        }

        console.log("RabbitMQ Connection Established");

        connection.on("error", err => {
            console.error("RabbitMQ Connection Error:", err.message);
            // Only reconnect if the connection is not closing intentionally
            if (err.message !== "Connection closing") {
                setTimeout(() => connectToRabbitMQ(callback), backoffDelay);
            }
        });

        connection.on("close", () => {
            console.warn("RabbitMQ Connection Closed. Reconnecting...");
            setTimeout(() => connectToRabbitMQ(callback), backoffDelay);
        });

        console.log("Calling createChannel...");
        connection.createChannel((error, channel) => {
            if (error) {
                console.error("RabbitMQ Channel Creation Error:", error.message);
                return;
            }

            console.log("RabbitMQ Channel Created");

            // Setup Dead Letter Exchange (DLX) and Dead Letter Queue (DLQ).
            // Messages that cannot be processed are routed to the DLQ via the DLX.
            channel.assertExchange(RabbitMQDLX, 'direct', { durable: RabbitMQDurable });
            channel.assertQueue(RabbitMQDLQ, { durable: RabbitMQDurable });
            channel.bindQueue(RabbitMQDLQ, RabbitMQDLX, RabbitMQDLXRoutingKey);

            // Main queue is configured to use the DLX for failed messages.
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
    // Close channel and connection if they exist.
    if (rabbitmqChannel) await rabbitmqChannel.close();
    if (rabbitmqConnection) await rabbitmqConnection.close();
}

module.exports = {
    connectToRabbitMQ,
    closeRabbitMQ,
    RabbitMQQueueName,
    RabbitMQDurable,
};
