const mockChannel = {
    assertQueue: jest.fn().mockResolvedValue(),
    sendToQueue: jest.fn().mockImplementation((queue, message, options) => {
        console.log(`Message sent to ${queue}:`, message.toString());
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
