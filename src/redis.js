const Redis = require('ioredis');
require('dotenv').config();

const redisIP = process.env.REDIS_IP;
const redisPort = process.env.REDIS_PORT;
const redisPassword = process.env.REDIS_PASSWORD;
const redisApiKeySetName = process.env.REDIS_API_KEY_SET_NAME || 'api_keys';
const redisApiKeyChannelName = process.env.REDIS_API_KEY_CHANNEL_NAME || 'api-keys-channel';
const redisAdminKeySetName = process.env.REDIS_ADMIN_KEY_SET_NAME || 'admin_keys';

// Use two separate Redis clients: one for pub/sub (notifications), one for data operations.
// This is necessary because a Redis client subscribed to channels cannot be used for normal commands.
const redisPubSub = new Redis({ host: redisIP, port: redisPort, password: redisPassword });
const redisData = new Redis({ host: redisIP, port: redisPort, password: redisPassword });

async function closeRedisConnections() {
    await redisPubSub.quit();
    await redisData.quit();
}

// Export set/channel names so other modules can use the same Redis keys consistently.
module.exports = {
    redisPubSub,
    redisData,
    closeRedisConnections,
    redisApiKeySetName,
    redisApiKeyChannelName,
    redisAdminKeySetName,
};
