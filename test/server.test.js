jest.mock('ioredis');
jest.mock('amqplib');

const { buildServer } = require('../src/index.js');
const { redisData } = require('../src/redis.js');
const amqplib = require('amqplib'); // Import the mocked amqplib

describe('Fastify Server', () => {
    let fastify;

    beforeAll(async () => {
        // Mock Redis API key validation
        jest.spyOn(redisData, 'sismember').mockResolvedValue(1);

        // Ensure RabbitMQ mock methods are being called
        jest.spyOn(amqplib, 'connect');

    });

    beforeEach(async () => {
        fastify = buildServer();
        await fastify.ready();
    });

    afterEach(async () => {
        await fastify.close();  
    });

    test('Rejects request with missing API key', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/data',
            payload: 'Test',
            headers: { 'Content-Type': 'text/plain' },
        });

        expect(response.statusCode).toBe(401);
        expect(response.body).toBe('Missing API key');
    });

    test('Rejects request with invalid API key', async () => {
        // Mock Redis API key fail
        jest.spyOn(redisData, 'sismember').mockResolvedValue(0);

        const response = await fastify.inject({
            method: 'POST',
            url: '/data',
            payload: 'Test',
            headers: { 'Content-Type': 'text/plain' },
        });

        expect(response.statusCode).toBe(401);
        expect(response.body).toBe('Missing API key');
    });

    test('Accepts request with valid API key', async () => {
        jest.spyOn(redisData, 'sismember').mockResolvedValue(1);

        const response = await fastify.inject({
            method: 'POST',
            url: '/data',
            headers: { 'x-api-key': 'valid-api-key', 'Content-Type': 'text/plain' },
            payload: 'Test',
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toBe('OK');
    });

    test('Accepts stats endpoint with valid admin API key', async () => {
        jest.spyOn(redisData, 'sismember').mockResolvedValue(1);

        // Mock process methods as functions
        const uptimeMock = jest.spyOn(process, 'uptime').mockImplementation(() => 123.45);
        const memoryUsageMock = jest.spyOn(process, 'memoryUsage').mockImplementation(() => ({ rss: 1000, heapTotal: 2000, heapUsed: 1500 }));

        // Define process.availableMemory if not present
        if (!process.availableMemory) {
            process.availableMemory = () => 4096;
        }
        const availableMemoryMock = jest.spyOn(process, 'availableMemory').mockImplementation(() => 4096);

        // Mock rabbitmqChannel and checkQueueAsync
        const mockQueueInfo = { messageCount: 5 };
        const mockDlqInfo = { messageCount: 0 };
        const origBuildServer = require('../src/index.js').buildServer;
        const origCheckQueueAsync = require('../src/index.js').checkQueueAsync;

        // Patch buildServer to inject a mock rabbitmqChannel with checkQueue
        const app = origBuildServer();
        app.ready = async () => {}; // skip ready
        app.rabbitmqChannel = {
            checkQueue: jest.fn((queue, cb) => {
                if (queue === 'dlq') cb(null, mockDlqInfo);
                else cb(null, mockQueueInfo);
            })
        };

        const response = await fastify.inject({
            method: 'GET',
            url: '/stats',
            headers: { 'x-api-key': 'valid-admin-key', 'Content-Type': 'text/plain' },
        });

        expect(response.statusCode).toBe(200);
        expect(() => JSON.parse(response.body)).not.toThrow();
        const stats = JSON.parse(response.body);
        expect(stats).toHaveProperty('uptime', 123.45);
        expect(stats).toHaveProperty('memoryUsage', { rss: 1000, heapTotal: 2000, heapUsed: 1500 });
        expect(stats).toHaveProperty('availableMemory', 4096);
        expect(stats).toHaveProperty('redisConnected');
        expect(stats).toHaveProperty('rabbitMQConnected');
        expect(stats).toHaveProperty('messagesProcessed');
        expect(stats).toHaveProperty('errors');
        expect(stats).toHaveProperty('queueDepth');
        expect(stats).toHaveProperty('deadLetterQueueDepth');

        uptimeMock.mockRestore();
        memoryUsageMock.mockRestore();
        availableMemoryMock.mockRestore();
    });

    test('Handles missing message payload', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/data',
            headers: { 'x-api-key': 'valid-api-key', 'Content-Type': 'text/plain' },
        });

        expect(response.statusCode).toBe(400);
        expect(response.body).toBe('Message payload is required');
    });

    test('Rejects request with empty API key', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/data',
            headers: { 'x-api-key': '', 'Content-Type': 'text/plain' },
            payload: 'Test',
        });

        expect(response.statusCode).toBe(401);
        expect(response.body).toBe('Missing API key');
    });

    test('Rejects request with too large payload', async () => {
        const largePayload = 'x'.repeat(10001);
        const response = await fastify.inject({
            method: 'POST',
            url: '/data',
            headers: { 'x-api-key': 'valid-api-key', 'Content-Type': 'text/plain' },
            payload: largePayload,
        });

        expect(response.statusCode).toBe(413);
        expect(response.body).toBe('Payload too large');
    });

    test('Handles unsupported content type', async () => {
        jest.spyOn(redisData, 'sismember').mockResolvedValue(1);

        const response = await fastify.inject({
            method: 'POST',
            url: '/data',
            headers: { 'x-api-key': 'valid-api-key', 'Content-Type': 'text/json' },
            payload: 'Test',
        });

        expect(response.statusCode).toBe(415);
        expect(response.body).toBe('Unsupported Media Type');
    });

    test('Handles Redis connection failure', async () => {
        jest.spyOn(redisData, 'sismember').mockRejectedValue(new Error('Some error.'));

        const response = await fastify.inject({
            method: 'POST',
            url: '/data',
            headers: { 'x-api-key': 'valid-api-key', 'Content-Type': 'text/plain' },
            payload: 'Test',
        });

        expect(response.statusCode).toBe(500);
        expect(response.body).toBe('Redis Connection Error');
    });

    test('Handles RabbitMQ connection failure', async () => {
        // Simulate RabbitMQ connection failure before server starts
        await fastify.close();

        jest.spyOn(redisData, 'sismember').mockResolvedValue(1);
        jest.spyOn(amqplib, 'connect').mockImplementation((url, callback) => {
            callback(new Error('RabbitMQ connection error'), null);
        });

        fastify = buildServer();
        await fastify.ready();

        const response = await fastify.inject({
            method: 'POST',
            url: '/data',
            headers: { 'x-api-key': 'valid-api-key', 'Content-Type': 'text/plain' },
            payload: 'Test',
        });

        expect(response.statusCode).toBe(503);
        expect(response.body).toBe('RabbitMQ is not available, try again later');
    });

    test('Rejects stats endpoint with invalid admin API key', async () => {
        jest.spyOn(redisData, 'sismember').mockResolvedValue(0);

        const response = await fastify.inject({
            method: 'GET',
            url: '/stats',
            headers: { 'x-api-key': 'invalid-admin-key', 'Content-Type': 'text/plain' },
        });

        expect(response.statusCode).toBe(401);
        expect(response.body).toBe('Invalid API key');
    });

    test('Rejects stats endpoint with missing API key', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/stats',
            headers: { 'Content-Type': 'text/plain' },
        });

        expect(response.statusCode).toBe(401);
        expect(response.body).toBe('Missing API key');
    });

    test('Handles Redis error on stats endpoint', async () => {
        jest.spyOn(redisData, 'sismember').mockRejectedValue(new Error('Redis error'));

        const response = await fastify.inject({
            method: 'GET',
            url: '/stats',
            headers: { 'x-api-key': 'valid-admin-key', 'Content-Type': 'text/plain' },
        });

        expect(response.statusCode).toBe(500);
        expect(response.body).toBe('Redis Connection Error');
    });

    test('Handles RabbitMQ error on stats endpoint', async () => {
        jest.spyOn(redisData, 'sismember').mockResolvedValue(1);

        // Patch rabbitmqChannel to throw error on checkQueue
        fastify.rabbitmqChannel = {
            checkQueue: jest.fn((queue, cb) => cb(new Error('RabbitMQ error')))
        };

        const response = await fastify.inject({
            method: 'GET',
            url: '/stats',
            headers: { 'x-api-key': 'valid-admin-key', 'Content-Type': 'text/plain' },
        });

        expect(response.statusCode).toBe(500);
        expect(response.body).toBe('Failed to retrieve server stats');
    });
});
