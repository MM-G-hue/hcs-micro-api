jest.mock('ioredis');
jest.mock('amqplib'); // Ensure this is called before importing anything that uses amqplib

const { buildServer } = require('../src/index.js');
const { redisData } = require('../src/redis'); // Import redisData
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
            url: '/message',
            payload: { message: 'Test' },
        });

        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ message: 'Missing API key' });
    });

    test('Rejects request with invalid API key', async () => {
        // Mock Redis API key fail
        jest.spyOn(redisData, 'sismember').mockResolvedValue(0);

        const response = await fastify.inject({
            method: 'POST',
            url: '/message',
            payload: { message: 'Test' },
        });

        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ message: 'Missing API key' });
    });

    test('Accepts request with valid API key', async () => {
        // Mock Redis API key fail
        jest.spyOn(redisData, 'sismember').mockResolvedValue(1);

        const response = await fastify.inject({
            method: 'POST',
            url: '/message',
            headers: { 'x-api-key': 'valid-api-key' },
            payload: { message: 'Hello' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ status: 'Message sent successfully' });
    });

    test('Handles missing message payload', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/message',
            headers: { 'x-api-key': 'valid-api-key' },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ message: 'Message payload is required' });
    });

    test('Handles Redis connection failure', async () => {
        jest.spyOn(redisData, 'sismember').mockRejectedValue(new Error('Redis connection error'));

        const response = await fastify.inject({
            method: 'POST',
            url: '/message',
            headers: { 'x-api-key': 'valid-api-key' },
            payload: { message: 'Test Message' },
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
            url: '/message',
            headers: { 'x-api-key': 'valid-api-key' },
            payload: { message: 'Test Message rabbitMQ' },
        });

        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({ message: 'RabbitMQ is not available, try again later' });
    });

    test('Handles unsupported HTTP methods', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/message',
            headers: { 'x-api-key': 'valid-api-key' },
        });

        expect(response.statusCode).toBe(405);
        expect(response.json()).toEqual({ message: 'Method Not Allowed' });
    });
});
