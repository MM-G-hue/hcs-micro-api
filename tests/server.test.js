const { buildServer } = require('../src/index.js');
const { redisData } = require('../src/redis'); // Import redisData
const amqplib = require('amqplib'); // Import the mocked amqplib

jest.mock('ioredis');
jest.mock('amqplib');

describe('Fastify Server', () => {
    let fastify;

    beforeAll(async () => {
        // Mock Redis API key validation
        jest.spyOn(redisData, 'sismember').mockResolvedValue(1);

        // // Ensure RabbitMQ mock methods are being called
        // jest.spyOn(amqplib, 'connect');

        // Start server
        fastify = buildServer();
        await fastify.ready();
    });

    afterAll(async () => {
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
        jest.spyOn(redisData, 'sismember').mockResolvedValue(0);

        const response = await fastify.inject({
            method: 'POST',
            url: '/message',
            headers: { 'x-api-key': 'valid-api-key' },
            payload: { message: 'Hello' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ status: 'Message sent successfully' });
    });

    test('Sends message to RabbitMQ', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/message',
            headers: { 'x-api-key': 'valid-api-key' },
            payload: { message: 'Test Message' },
        });

        // Verify RabbitMQ mock methods were called
        expect(amqplib.connect).toHaveBeenCalled();
        expect(response.statusCode).toBe(200);
    });
});
