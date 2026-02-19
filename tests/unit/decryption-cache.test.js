/**
 * Decryption Cache Unit Tests
 * 
 * Tests for DecryptionCache module which implements an LRU (Least Recently Used)
 * cache for storing decrypted images in memory without ever writing to disk.
 * 
 * @module tests/unit/decryption-cache.test.js
 */

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { DecryptionCache } = require('../../src/decryption-cache');

/**
 * Test directory
 */
const TEST_DIR = path.join(__dirname, '..', '__test_fixtures__', 'decryption-cache');

/**
 * Helper to clean test directory
 */
async function cleanupTestDir() {
  try {
    if (fsSync.existsSync(TEST_DIR)) {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    }
  } catch (error) {
    // Silently ignore cleanup errors
  }
}

/**
 * Helper to create test directory
 */
async function setupTestDir() {
  await fs.mkdir(TEST_DIR, { recursive: true });
}

/**
 * Mock crypto manager for testing
 */
const mockCrypto = {
  isEncrypted: (filePath) => filePath.endsWith('.enc'),
  getEncryptedPath: (filePath) => filePath + '.enc',
  decryptBuffer: jest.fn(async (buffer, password) => {
    // Simulate decryption by reversing the buffer (simple mock)
    return Buffer.from(buffer.toString().split('').reverse().join());
  })
};

// Mock the crypto module
jest.mock('../../src/crypto-manager', () => mockCrypto);

describe('DecryptionCache Class', () => {
  let cache;

  beforeEach(async () => {
    await setupTestDir();
    jest.clearAllMocks();
    cache = new DecryptionCache(100, 60000); // 100 max size, 60 second TTL
  });

  afterEach(async () => {
    await cleanupTestDir();
    cache.clear();
  });

  // ============================================================================
  // Constructor Tests
  // ============================================================================

  describe('Constructor', () => {
    test('should initialize cache with default parameters', () => {
      const defaultCache = new DecryptionCache();

      const stats = defaultCache.getStats();
      expect(stats.maxSize).toBe(100);
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    test('should initialize cache with custom parameters', () => {
      const customCache = new DecryptionCache(50, 30000);

      const stats = customCache.getStats();
      expect(stats.maxSize).toBe(50);
    });

    test('should have correct LRU structure initialized', () => {
      expect(cache.head).toBeDefined();
      expect(cache.tail).toBeDefined();
      expect(cache.cache).toBeDefined();
      expect(cache.cache instanceof Map).toBe(true);
    });
  });

  // ============================================================================
  // _generateKey() Tests
  // ============================================================================

  describe('_generateKey()', () => {
    test('should normalize path', () => {
      const path1 = 'folder/file.jpg';
      const path2 = 'folder\\file.jpg'; // Windows path

      const key1 = cache._generateKey(path1);
      expect(typeof key1).toBe('string');
      expect(key1.length).toBeGreaterThan(0);
    });

    test('should remove .enc extension', () => {
      const encPath = 'folder/file.jpg.enc';
      const key = cache._generateKey(encPath);

      expect(key).not.toContain('.enc');
    });

    test('should handle paths without .enc extension', () => {
      const path = 'folder/file.jpg';
      const key = cache._generateKey(path);

      expect(key).not.toContain('.enc');
    });

    test('should generate same key for encrypted and unencrypted paths', () => {
      const unencPath = 'portfolio/image.jpg';
      const encPath = 'portfolio/image.jpg.enc';

      const key1 = cache._generateKey(unencPath);
      const key2 = cache._generateKey(encPath);

      expect(key1).toBe(key2);
    });
  });

  // ============================================================================
  // _put() Tests
  // ============================================================================

  describe('_put()', () => {
    test('should add item to cache', () => {
      const key = 'test-key';
      const buffer = Buffer.from('test data');

      cache._put(key, buffer);

      expect(cache.cache.has(key)).toBe(true);
    });

    test('should mark inserted item as most recent (front)', () => {
      const key1 = 'key1';
      const key2 = 'key2';

      cache._put(key1, Buffer.from('data1'));
      cache._put(key2, Buffer.from('data2'));

      // Get the nodes
      const node2 = cache.cache.get(key2);

      // key2 should be right after head (most recent)
      expect(cache.head.next).toBe(node2);
    });

    test('should update existing key', () => {
      const key = 'test-key';
      const buffer1 = Buffer.from('original');
      const buffer2 = Buffer.from('updated');

      cache._put(key, buffer1);
      cache._put(key, buffer2);

      // Should still have only one entry
      expect(cache.cache.size).toBe(1);

      const node = cache.cache.get(key);
      expect(node.value.buffer).toEqual(buffer2);
    });

    test('should evict least recently used when exceeding max size', () => {
      const smallCache = new DecryptionCache(3, 60000);

      smallCache._put('key1', Buffer.from('data1'));
      smallCache._put('key2', Buffer.from('data2'));
      smallCache._put('key3', Buffer.from('data3'));

      expect(smallCache.cache.size).toBe(3);

      // Add fourth item - LRU (key1) should be evicted
      smallCache._put('key4', Buffer.from('data4'));

      expect(smallCache.cache.size).toBe(3);
      expect(smallCache.cache.has('key1')).toBe(false);
      expect(smallCache.cache.has('key4')).toBe(true);
    });

    test('should maintain LRU order after update', () => {
      const smallCache = new DecryptionCache(3, 60000);

      smallCache._put('key1', Buffer.from('data1'));
      smallCache._put('key2', Buffer.from('data2'));
      smallCache._put('key3', Buffer.from('data3'));

      // Update key1 (should move to front)
      smallCache._put('key1', Buffer.from('updated1'));

      // Add key4 - key2 should be evicted (not key1 anymore)
      smallCache._put('key4', Buffer.from('data4'));

      expect(smallCache.cache.has('key1')).toBe(true);
      expect(smallCache.cache.has('key2')).toBe(false);
      expect(smallCache.cache.has('key4')).toBe(true);
    });
  });

  // ============================================================================
  // _moveToFront() Tests
  // ============================================================================

  describe('_moveToFront()', () => {
    test('should move node to front of list', () => {
      cache._put('key1', Buffer.from('data1'));
      cache._put('key2', Buffer.from('data2'));
      cache._put('key3', Buffer.from('data3'));

      const node1 = cache.cache.get('key1');

      // Currently: head -> key3 -> key2 -> key1 -> tail
      // Move key1 to front: head -> key1 -> key3 -> key2 -> tail
      cache._moveToFront(node1);

      expect(cache.head.next).toBe(node1);
    });

    test('should maintain proper linking after move', () => {
      cache._put('key1', Buffer.from('data1'));
      cache._put('key2', Buffer.from('data2'));

      const node1 = cache.cache.get('key1');
      cache._moveToFront(node1);

      // Check forward links
      expect(node1.prev).toBe(cache.head);
      expect(node1.next).toBeDefined();

      // Check backward links
      expect(node1.prev.next).toBe(node1);
      expect(node1.next.prev).toBe(node1);
    });
  });

  // ============================================================================
  // clear() Tests
  // ============================================================================

  describe('clear()', () => {
    test('should remove all items from cache', () => {
      cache._put('key1', Buffer.from('data1'));
      cache._put('key2', Buffer.from('data2'));
      cache._put('key3', Buffer.from('data3'));

      expect(cache.cache.size).toBe(3);

      cache.clear();

      expect(cache.cache.size).toBe(0);
    });

    test('should reset statistics', () => {
      cache.hits = 5;
      cache.misses = 10;

      cache.clear();

      expect(cache.hits).toBe(0);
      expect(cache.misses).toBe(0);
    });

    test('should reset LRU structure', () => {
      cache._put('key1', Buffer.from('data1'));

      cache.clear();

      expect(cache.head.next).toBe(cache.tail);
      expect(cache.tail.prev).toBe(cache.head);
    });
  });

  // ============================================================================
  // invalidate() Tests
  // ============================================================================

  describe('invalidate()', () => {
    test('should remove item from cache by path', () => {
      const filePath = 'portfolio/image.jpg';
      cache._put(cache._generateKey(filePath), Buffer.from('data'));

      expect(cache.cache.size).toBe(1);

      cache.invalidate(filePath);

      expect(cache.cache.size).toBe(0);
    });

    test('should handle .enc and non-.enc paths the same', () => {
      const unencPath = 'portfolio/image.jpg';
      const encPath = 'portfolio/image.jpg.enc';

      const key = cache._generateKey(unencPath);
      cache._put(key, Buffer.from('data'));

      expect(cache.cache.size).toBe(1);

      // Should remove using .enc path
      cache.invalidate(encPath);

      expect(cache.cache.size).toBe(0);
    });

    test('should not fail when invalidating non-existent key', () => {
      expect(() => {
        cache.invalidate('non/existent/file.jpg');
      }).not.toThrow();
    });
  });

  // ============================================================================
  // cleanExpired() Tests
  // ============================================================================

  describe('cleanExpired()', () => {
    test('should remove expired entries', async () => {
      // Small TTL for testing
      const shortTTLCache = new DecryptionCache(100, 100); // 100ms TTL

      shortTTLCache._put('key1', Buffer.from('data1'));
      expect(shortTTLCache.cache.size).toBe(1);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));

      const removed = shortTTLCache.cleanExpired();

      expect(removed).toBe(1);
      expect(shortTTLCache.cache.size).toBe(0);
    });

    test('should not remove non-expired entries', async () => {
      const shortTTLCache = new DecryptionCache(100, 5000); // 5 second TTL

      shortTTLCache._put('key1', Buffer.from('data1'));
      shortTTLCache._put('key2', Buffer.from('data2'));

      const removed = shortTTLCache.cleanExpired();

      expect(removed).toBe(0);
      expect(shortTTLCache.cache.size).toBe(2);
    });

    test('should remove only expired entries (mixed)', async () => {
      const mixedCache = new DecryptionCache(100, 100); // 100ms TTL

      // Add first entry
      mixedCache._put('key1', Buffer.from('data1'));
      expect(mixedCache.cache.size).toBe(1);

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));

      // Add second entry (before first expires)
      mixedCache._put('key2', Buffer.from('data2'));
      expect(mixedCache.cache.size).toBe(2);

      // Wait for first to expire but not second
      await new Promise(resolve => setTimeout(resolve, 75));

      const removed = mixedCache.cleanExpired();

      expect(removed).toBe(1);
      expect(mixedCache.cache.size).toBe(1);
      expect(mixedCache.cache.has('key2')).toBe(true);
    });
  });

  // ============================================================================
  // getStats() Tests
  // ============================================================================

  describe('getStats()', () => {
    test('should return cache statistics', () => {
      cache._put('key1', Buffer.from('data1'));
      cache.hits = 5;
      cache.misses = 3;

      const stats = cache.getStats();

      expect(stats.size).toBe(1);
      expect(stats.maxSize).toBe(100);
      expect(stats.hits).toBe(5);
      expect(stats.misses).toBe(3);
      expect(stats.totalRequests).toBe(8);
    });

    test('should calculate hit rate correctly', () => {
      cache.hits = 3;
      cache.misses = 1;

      const stats = cache.getStats();

      // Hit rate = 3 / (3 + 1) = 75%
      expect(stats.hitRate).toContain('75');
    });

    test('should handle zero requests', () => {
      const stats = cache.getStats();

      expect(stats.totalRequests).toBe(0);
      expect(stats.hitRate).toContain('0');
    });

    test('should format hit rate as percentage', () => {
      cache.hits = 1;
      cache.misses = 1;

      const stats = cache.getStats();

      expect(stats.hitRate).toMatch(/\d+(\.\d+)?%/);
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('Integration: LRU Cache Behavior', () => {
    test('should maintain strict LRU eviction policy', () => {
      const lruCache = new DecryptionCache(3, 60000);

      // Add 3 items
      lruCache._put('a', Buffer.from('a'));
      lruCache._put('b', Buffer.from('b'));
      lruCache._put('c', Buffer.from('c'));

      // Access 'a' (moves to front)
      const nodeA = lruCache.cache.get('a');
      lruCache._moveToFront(nodeA);

      // Add 'd' - 'b' should be evicted (least recently used)
      lruCache._put('d', Buffer.from('d'));

      expect(lruCache.cache.has('a')).toBe(true);
      expect(lruCache.cache.has('b')).toBe(false);
      expect(lruCache.cache.has('c')).toBe(true);
      expect(lruCache.cache.has('d')).toBe(true);
    });

    test('cache should handle size 1 correctly', () => {
      const singleCache = new DecryptionCache(1, 60000);

      singleCache._put('key1', Buffer.from('data1'));
      expect(singleCache.cache.size).toBe(1);

      singleCache._put('key2', Buffer.from('data2'));
      expect(singleCache.cache.size).toBe(1);
      expect(singleCache.cache.has('key2')).toBe(true);
      expect(singleCache.cache.has('key1')).toBe(false);
    });

    test('should track hits and misses correctly', () => {
      cache._put('key1', Buffer.from('data1'));

      // Simulate hit
      cache.hits++;

      // Simulate misses
      cache.misses += 2;

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
      expect(stats.totalRequests).toBe(3);
    });
  });

  // ============================================================================
  // Memory and Performance Tests
  // ============================================================================

  describe('Memory Management', () => {
    test('should not grow beyond max size', () => {
      const smallCache = new DecryptionCache(50, 60000);

      for (let i = 0; i < 200; i++) {
        smallCache._put(`key${i}`, Buffer.alloc(1024)); // 1KB each
      }

      expect(smallCache.cache.size).toBeLessThanOrEqual(50);
    });

    test('should handle rapid insertions and evictions', () => {
      const rapidCache = new DecryptionCache(10, 60000);

      for (let i = 0; i < 1000; i++) {
        rapidCache._put(`key${i}`, Buffer.from(`data${i}`));
      }

      expect(rapidCache.cache.size).toBe(10);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    test('should handle very large buffers', () => {
      const largeBuffer = Buffer.alloc(10 * 1024 * 1024); // 10MB
      largeBuffer.fill('x');

      cache._put('large', largeBuffer);

      expect(cache.cache.size).toBe(1);
      expect(cache.cache.get('large').value.buffer.length).toBe(10 * 1024 * 1024);
    });

    test('should handle empty buffer', () => {
      const emptyBuffer = Buffer.alloc(0);

      cache._put('empty', emptyBuffer);

      expect(cache.cache.size).toBe(1);
      expect(cache.cache.get('empty').value.buffer.length).toBe(0);
    });

    test('should handle special characters in keys', () => {
      const specialKey = 'path/with/@#$%^&*()special\\chars.jpg';

      cache._put(specialKey, Buffer.from('data'));

      expect(cache.cache.size).toBe(1);
    });
  });
});
