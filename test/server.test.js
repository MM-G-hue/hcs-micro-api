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
        // fastify.clearApiKeys();
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
        expect(response.json()).toEqual({ message: 'Missing API key' });
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
        expect(response.json()).toEqual({ message: 'Missing API key' });
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
        expect(response.json()).toEqual({ status: 'Message sent successfully' });
    });

    test('Handles missing message payload', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/data',
            headers: { 'x-api-key': 'valid-api-key', 'Content-Type': 'text/plain' },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ message: 'Message payload is required' });
    });

    
    test('Handles unsupported HTTP methods', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/data',
            headers: { 'x-api-key': 'valid-api-key', 'Content-Type': 'text/plain' },
            payload: 'Test',
        });

        expect(response.statusCode).toBe(405);
        expect(response.json()).toEqual({ message: 'Method Not Allowed' });
    });

    test('Rejects request with empty API key', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/data',
            headers: { 'x-api-key': '', 'Content-Type': 'text/plain' },
            payload: 'Test',
        });

        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ message: 'Missing API key' });
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
        expect(response.json()).toEqual({ message: 'Payload too large' });
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
        expect(response.json()).toEqual({ message: 'Unsupported Media Type' });
    });

    test('Handles Redis connection failure', async () => {
        jest.spyOn(redisData, 'sismember').mockRejectedValue(new Error('Redis connection error'));

        const response = await fastify.inject({
            method: 'POST',
            url: '/data',
            headers: { 'x-api-key': 'valid-api-key', 'Content-Type': 'text/plain' },
            payload: 'Test',
        });

        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({ message: 'Redis Connection Error' });
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
        expect(response.json()).toEqual({ message: 'RabbitMQ is not available, try again later' });
    });
});
