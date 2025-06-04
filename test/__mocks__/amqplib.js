const mockChannel = {
    assertQueue: jest.fn().mockResolvedValue(),
    assertExchange: jest.fn().mockResolvedValue(),
    bindQueue: jest.fn().mockResolvedValue(),
    checkQueue: jest.fn().mockImplementation((queue, callback) => {
        console.log(`Mock RabbitMQ Check Queue: ${queue}`);
        // Simulate a successful check queue operation
        callback(null, { queue: queue, messageCount: 0 });
    }),
    sendToQueue: jest.fn().mockImplementation((queue, message, options) => {
        // Optionally do something with the message
    }),
    close: jest.fn().mockResolvedValue(),
};

const mockConnection = {
    createChannel: jest.fn().mockImplementation((callback) => {
        console.log("Mock RabbitMQ Channel Created");
        callback(null, mockChannel); // Simulate successful channel creation
    }),
    close: jest.fn().mockResolvedValue(),
    on: jest.fn(),
};

const amqplib = {
    connect: jest.fn().mockImplementation((url, callback) => {
        console.log("Mock RabbitMQ Connected");
        callback(null, mockConnection); // Simulate successful connection
    }),
};

console.log("Mock RabbitMQ module loaded");

module.exports = amqplib;
