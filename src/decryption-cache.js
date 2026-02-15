/**
 * Decryption Cache - LRU In-Memory Cache for Decrypted Images
 *
 * Maintains decrypted images in RAM (never on disk) using
 * an LRU (Least Recently Used) strategy to limit memory usage.
 *
 * @module decryption-cache
 * @author Antonio Sánchez León
 */

const crypto = require('./crypto-manager');
const fs = require('fs').promises;
const path = require('path');

// Cache configuration constants
const DEFAULT_MAX_CACHE_SIZE = 100;
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
const PERCENTAGE_PRECISION = 1;

/**
 * Nodo de la lista doblemente enlazada para el cache LRU
 */
class CacheNode {
    constructor(key, value) {
        this.key = key;
        this.value = value;
        this.prev = null;
        this.next = null;
    }
}

/**
 * LRU (Least Recently Used) cache for storing decrypted images in memory
 */
class DecryptionCache {
    /**
     * @param {number} maxSize - Maximum number of images to keep in cache
     * @param {number} maxAge - Maximum time in ms an entry can remain in cache
     */
    constructor(maxSize = DEFAULT_MAX_CACHE_SIZE, maxAge = DEFAULT_MAX_AGE_MS) {
        this.maxSize = maxSize;
        this.maxAge = maxAge;
        this.cache = new Map();
        this.head = new CacheNode('HEAD', null); // Dummy head (most recent)
        this.tail = new CacheNode('TAIL', null); // Dummy tail (least recent)
        this.head.next = this.tail;
        this.tail.prev = this.head;

        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Gets a decrypted image from cache or decrypts it if not cached
     *
     * @param {string} filePath - Absolute path to encrypted file
     * @param {string} password - Password for decryption
     * @returns {Promise<Buffer>} Buffer of the decrypted image
     */
    async get(filePath, password) {
        const key = this._generateKey(filePath);

        if (this.cache.has(key)) {
            const node = this.cache.get(key);
            const isExpired = Date.now() - node.value.timestamp > this.maxAge;

            if (isExpired) {
                this._remove(node);
                this.cache.delete(key);
            } else {
                this._moveToFront(node);
                this.hits++;
                return node.value.buffer;
            }
        }

        this.misses++;
        const buffer = await this._decryptFromDisk(filePath, password);
        this._put(key, buffer);

        return buffer;
    }

    /**
     * Decrypts a file from disk directly to memory (WITHOUT writing decrypted file)
     *
     * @param {string} filePath - File path (may be encrypted or not)
     * @param {string} password - Decryption password
     * @returns {Promise<Buffer>} Decrypted buffer
     * @private
     */
    async _decryptFromDisk(filePath, password) {
        const encryptedPath = crypto.isEncrypted(filePath)
            ? filePath
            : crypto.getEncryptedPath(filePath);

        try {
            const encryptedBuffer = await fs.readFile(encryptedPath);
            return await crypto.decryptBuffer(encryptedBuffer, password);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return await fs.readFile(filePath);
            }
            throw error;
        }
    }

    /**
     * Generates a unique cache key
     *
     * @param {string} filePath - File path
     * @returns {string} Normalized cache key
     * @private
     */
    _generateKey(filePath) {
        return path.normalize(filePath).replace(/\.enc$/i, '');
    }

    /**
     * Stores a buffer in the cache
     *
     * @param {string} key - Cache key
     * @param {Buffer} buffer - Buffer to store
     * @private
     */
    _put(key, buffer) {
        if (this.cache.has(key)) {
            const node = this.cache.get(key);
            node.value = { buffer, timestamp: Date.now() };
            this._moveToFront(node);
            return;
        }

        if (this.cache.size >= this.maxSize) {
            const lru = this.tail.prev;
            this._remove(lru);
            this.cache.delete(lru.key);
        }

        const newNode = new CacheNode(key, { buffer, timestamp: Date.now() });
        this.cache.set(key, newNode);
        this._addToFront(newNode);
    }

    /**
     * Adds a node to the front of the list (most recent)
     *
     * @param {CacheNode} node - Node to add
     * @private
     */
    _addToFront(node) {
        node.prev = this.head;
        node.next = this.head.next;
        this.head.next.prev = node;
        this.head.next = node;
    }

    /**
     * Removes a node from the list
     *
     * @param {CacheNode} node - Node to remove
     * @private
     */
    _remove(node) {
        node.prev.next = node.next;
        node.next.prev = node.prev;
    }

    /**
     * Moves a node to the front (marks as most recent)
     *
     * @param {CacheNode} node - Node to move
     * @private
     */
    _moveToFront(node) {
        this._remove(node);
        this._addToFront(node);
    }

    /**
     * Clears the entire cache
     */
    clear() {
        this.cache.clear();
        this.head.next = this.tail;
        this.tail.prev = this.head;
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Removes expired entries from the cache
     *
     * @returns {number} Number of removed entries
     */
    cleanExpired() {
        const now = Date.now();
        let removed = 0;

        for (const [key, node] of this.cache.entries()) {
            if (now - node.value.timestamp > this.maxAge) {
                this._remove(node);
                this.cache.delete(key);
                removed++;
            }
        }

        return removed;
    }

    /**
     * Gets cache statistics
     *
     * @returns {Object} Cache statistics
     */
    getStats() {
        const totalRequests = this.hits + this.misses;
        const hitRate = totalRequests > 0 ? (this.hits / totalRequests * 100) : 0;

        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hits: this.hits,
            misses: this.misses,
            hitRate: `${hitRate.toFixed(PERCENTAGE_PRECISION)}%`,
            totalRequests
        };
    }

    /**
     * Invalidates a specific cache entry (useful when a file is updated)
     *
     * @param {string} filePath - Path to the file to invalidate
     */
    invalidate(filePath) {
        const key = this._generateKey(filePath);

        if (this.cache.has(key)) {
            const node = this.cache.get(key);
            this._remove(node);
            this.cache.delete(key);
        }
    }
}

module.exports = { DecryptionCache };
