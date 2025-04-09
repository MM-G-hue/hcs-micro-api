class MockRedis {
    constructor() {
        this.data = new Set();
        this.subscriptions = {};
        this.eventListeners = {}; // Added to store event listeners
    }

    smembers(key) {
        return Promise.resolve(Array.from(this.data));
    }

    sismember(key, value) {
        return Promise.resolve(this.data.has(value) ? 1 : 0);
    }

    sadd(key, value) {
        this.data.add(value);
        return Promise.resolve(1);
    }

    srem(key, value) {
        this.data.delete(value);
        return Promise.resolve(1);
    }

    subscribe(channel, callback) {
        this.subscriptions[channel] = callback;
        return Promise.resolve(1);
    }

    publish(channel, message) {
        if (this.subscriptions[channel]) {
            this.subscriptions[channel](channel, message);
        }
        return Promise.resolve(1);
    }

    on(event, callback) {
        this.eventListeners[event] = callback; // Store the event listener
    }

    emit(event, ...args) {
        if (this.eventListeners[event]) {
            this.eventListeners[event](...args); // Trigger the event listener
        }
    }

    quit() {
        return Promise.resolve();
    }
}

// This mock implementation will use MockRedis constructor
module.exports = jest.fn(() => new MockRedis());
