const Redis = require('ioredis');
require('dotenv').config();

const redisIP = process.env.REDIS_IP;
const redisPort = process.env.REDIS_PORT;
const redisPassword = process.env.REDIS_PASSWORD;
const redisApiKeySetName = process.env.REDIS_API_KEY_SET_NAME || 'api_keys';
const redisApiKeyChannelName = process.env.REDIS_API_KEY_CHANNEL_NAME || 'api-keys-channel';

// Redis clients
const redisPubSub = new Redis({ host: redisIP, port: redisPort, password: redisPassword });
const redisData = new Redis({ host: redisIP, port: redisPort, password: redisPassword });

async function refreshApiKeys(localApiKeys) {
    try {
        const keys = await redisData.smembers(redisApiKeySetName);
        localApiKeys.clear();
        keys.forEach(key => localApiKeys.add(key));
        console.log(`Loaded ${keys.length} API keys from Redis.`);
    } catch (error) {
        console.error("Error refreshing API keys from Redis:", error);
    }
}

async function closeRedisConnections() {
    await redisPubSub.quit();
    await redisData.quit();
}

module.exports = {
    redisPubSub,
    redisData,
    refreshApiKeys,
    closeRedisConnections,
    redisApiKeySetName,
    redisApiKeyChannelName,
};
