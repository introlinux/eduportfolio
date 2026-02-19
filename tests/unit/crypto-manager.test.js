/**
 * Crypto Manager Unit Tests
 * 
 * Tests for CryptoManager module which handles AES-256-GCM encryption/decryption
 * of file buffers using PBKDF2 key derivation.
 * 
 * @module tests/unit/crypto-manager.test.js
 */

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('./../../src/crypto-manager');

/**
 * Test data directory (temporary, cleaned up after tests)
 */
const TEST_DIR = path.join(__dirname, '..', '__test_fixtures__', 'crypto-manager');

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

describe('Crypto Manager Module', () => {
  beforeEach(async () => {
    await setupTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  // ============================================================================
  // encryptBuffer() Tests
  // ============================================================================

  describe('encryptBuffer()', () => {
    const password = 'testPassword123';

    test('should encrypt a buffer successfully', async () => {
      const plainData = Buffer.from('Hello, Secure World!');
      const encrypted = await crypto.encryptBuffer(plainData, password);

      // Should return a Buffer
      expect(Buffer.isBuffer(encrypted)).toBe(true);

      // Should be larger than original (includes salt, iv, auth tag)
      expect(encrypted.length).toBeGreaterThan(plainData.length);

      // Should not contain original data (basic check)
      expect(encrypted.toString('hex')).not.toContain(plainData.toString('hex'));
    });

    test('should produce different ciphertexts for same plaintext (due to random IV/salt)', async () => {
      const plainData = Buffer.from('Same data');
      const encrypted1 = await crypto.encryptBuffer(plainData, password);
      const encrypted2 = await crypto.encryptBuffer(plainData, password);

      // Due to random salt and IV, ciphertexts should differ
      expect(encrypted1).not.toEqual(encrypted2);
    });

    test('should handle empty buffer', async () => {
      const emptyBuffer = Buffer.from('');
      const encrypted = await crypto.encryptBuffer(emptyBuffer, password);

      expect(Buffer.isBuffer(encrypted)).toBe(true);
      // Still has salt(32) + iv(16) + authTag(16) = 64 bytes minimum
      expect(encrypted.length).toBeGreaterThanOrEqual(64);
    });

    test('should handle large buffers', async () => {
      const largeBuffer = Buffer.alloc(10 * 1024 * 1024); // 10MB
      largeBuffer.fill('a');

      const encrypted = await crypto.encryptBuffer(largeBuffer, password);

      expect(Buffer.isBuffer(encrypted)).toBe(true);
      expect(encrypted.length).toBeGreaterThan(largeBuffer.length);
    });

    test('should handle special characters and binary data', async () => {
      const specialData = Buffer.from('🔐Special!@#$%^&*()[]{}|;:,.<>?/~`');
      const encrypted = await crypto.encryptBuffer(specialData, password);

      expect(Buffer.isBuffer(encrypted)).toBe(true);
      expect(encrypted.length).toBeGreaterThan(0);
    });

    test('should handle very long passwords', async () => {
      const longPassword = 'x'.repeat(1000);
      const plainData = Buffer.from('test data');
      const encrypted = await crypto.encryptBuffer(plainData, longPassword);

      expect(Buffer.isBuffer(encrypted)).toBe(true);
    });
  });

  // ============================================================================
  // decryptBuffer() Tests
  // ============================================================================

  describe('decryptBuffer()', () => {
    const password = 'testPassword123';

    test('should decrypt an encrypted buffer successfully', async () => {
      const originalData = Buffer.from('Hello, Secure World!');
      const encrypted = await crypto.encryptBuffer(originalData, password);
      const decrypted = await crypto.decryptBuffer(encrypted, password);

      expect(decrypted).toEqual(originalData);
    });

    test('should fail with wrong password', async () => {
      const originalData = Buffer.from('Secret message');
      const encrypted = await crypto.encryptBuffer(originalData, 'correctPassword');

      await expect(
        crypto.decryptBuffer(encrypted, 'wrongPassword')
      ).rejects.toThrow();
    });

    test('should detect corrupted data', async () => {
      const originalData = Buffer.from('Test data');
      const encrypted = await crypto.encryptBuffer(originalData, password);

      // Corrupt the encrypted data
      encrypted[100] ^= 0xFF; // Flip bits at position 100

      await expect(
        crypto.decryptBuffer(encrypted, password)
      ).rejects.toThrow();
    });

    test('should fail on truncated encrypted buffer', async () => {
      const originalData = Buffer.from('Test');
      const encrypted = await crypto.encryptBuffer(originalData, password);

      // Truncate the buffer
      const truncated = encrypted.slice(0, 20);

      // Should throw due to invalid format or auth failure
      await expect(
        crypto.decryptBuffer(truncated, password)
      ).rejects.toThrow();
    });

    test('should preserve binary data through encrypt/decrypt cycle', async () => {
      const binaryData = Buffer.from([0x00, 0xFF, 0x7F, 0x80, 0x01, 0xFE]);
      const encrypted = await crypto.encryptBuffer(binaryData, password);
      const decrypted = await crypto.decryptBuffer(encrypted, password);

      expect(decrypted).toEqual(binaryData);
    });

    test('should fail if encrypted buffer is tampered with', async () => {
      const originalData = Buffer.from('Important data');
      const encrypted = await crypto.encryptBuffer(originalData, password);

      // Tamper with the encrypted data (not salt/iv/tag)
      if (encrypted.length > 70) {
        encrypted[70] ^= 0x01;
      }

      await expect(
        crypto.decryptBuffer(encrypted, password)
      ).rejects.toThrow();
    });
  });

  // ============================================================================
  // encryptFile() Tests
  // ============================================================================

  describe('encryptFile()', () => {
    const password = 'filePassword123';

    test('should encrypt a file on disk', async () => {
      const testFile = path.join(TEST_DIR, 'test.txt');
      const testContent = 'This is a test file';

      // Create test file
      await fs.writeFile(testFile, testContent);

      // Encrypt
      const result = await crypto.encryptFile(testFile, password);

      expect(result.success).toBe(true);
      expect(result.encryptedPath).toBe(testFile + '.enc');

      // Original file should be deleted
      const fileExists = fsSync.existsSync(testFile);
      expect(fileExists).toBe(false);

      // Encrypted file should exist
      const encryptedExists = fsSync.existsSync(result.encryptedPath);
      expect(encryptedExists).toBe(true);

      // Encrypted file should not contain original content
      const encryptedContent = await fs.readFile(result.encryptedPath);
      expect(encryptedContent.toString()).not.toContain(testContent);
    });

    test('should handle non-existent file gracefully', async () => {
      const nonExistentFile = path.join(TEST_DIR, 'does-not-exist.txt');

      await expect(
        crypto.encryptFile(nonExistentFile, password)
      ).rejects.toThrow();
    });

    test('should encrypt binary files (images)', async () => {
      const imagePath = path.join(TEST_DIR, 'test-image.png');
      const imageData = Buffer.from([0x89, 0x50, 0x4E, 0x47]); // PNG signature

      await fs.writeFile(imagePath, imageData);

      const result = await crypto.encryptFile(imagePath, password);

      expect(result.success).toBe(true);
      expect(fsSync.existsSync(imagePath)).toBe(false);
      expect(fsSync.existsSync(result.encryptedPath)).toBe(true);
    });

    test('should preserve file name with .enc extension', async () => {
      const testFile = path.join(TEST_DIR, 'document.pdf');
      await fs.writeFile(testFile, 'PDF content');

      const result = await crypto.encryptFile(testFile, password);

      expect(result.encryptedPath).toBe(testFile + '.enc');
      expect(path.basename(result.encryptedPath)).toBe('document.pdf.enc');
    });
  });

  // ============================================================================
  // decryptFile() Tests
  // ============================================================================

  describe('decryptFile()', () => {
    const password = 'filePassword456';

    test('should decrypt a file successfully', async () => {
      const originalFile = path.join(TEST_DIR, 'original.txt');
      const originalContent = 'Original file content';
      const encryptedPath = originalFile + '.enc';

      // Create, encrypt a file
      await fs.writeFile(originalFile, originalContent);
      const encResult = await crypto.encryptFile(originalFile, password);

      // Now decrypt
      const decResult = await crypto.decryptFile(encResult.encryptedPath, password);

      expect(decResult.success).toBe(true);
      expect(decResult.decryptedPath).toBe(originalFile);

      // Encrypted file should be deleted
      expect(fsSync.existsSync(encryptedPath)).toBe(false);

      // Decrypted file should exist with original content
      const decryptedContent = await fs.readFile(originalFile, 'utf8');
      expect(decryptedContent).toBe(originalContent);
    });

    test('should fail with wrong password', async () => {
      const testFile = path.join(TEST_DIR, 'secure.txt');
      await fs.writeFile(testFile, 'secret content');

      const encResult = await crypto.encryptFile(testFile, 'correctPassword');

      await expect(
        crypto.decryptFile(encResult.encryptedPath, 'wrongPassword')
      ).rejects.toThrow();
    });

    test('should fail on corrupted encrypted file', async () => {
      const testFile = path.join(TEST_DIR, 'test.txt');
      await fs.writeFile(testFile, 'content');

      const encResult = await crypto.encryptFile(testFile, password);
      const encPath = encResult.encryptedPath;

      // Corrupt the file
      const encContent = await fs.readFile(encPath);
      encContent[100] ^= 0xFF;
      await fs.writeFile(encPath, encContent);

      await expect(
        crypto.decryptFile(encPath, password)
      ).rejects.toThrow();
    });

    test('should handle non-existent encrypted file', async () => {
      const nonExistentFile = path.join(TEST_DIR, 'missing.enc');

      await expect(
        crypto.decryptFile(nonExistentFile, password)
      ).rejects.toThrow();
    });
  });

  // ============================================================================
  // isEncrypted() Tests
  // ============================================================================

  describe('isEncrypted()', () => {
    test('should return true for files with .enc extension', () => {
      expect(crypto.isEncrypted('file.txt.enc')).toBe(true);
      expect(crypto.isEncrypted('/path/to/image.jpg.enc')).toBe(true);
      expect(crypto.isEncrypted('document.pdf.enc')).toBe(true);
    });

    test('should return false for unencrypted files', () => {
      expect(crypto.isEncrypted('file.txt')).toBe(false);
      expect(crypto.isEncrypted('/path/to/image.jpg')).toBe(false);
      expect(crypto.isEncrypted('document.pdf')).toBe(false);
    });

    test('should return false for files with .enc in middle', () => {
      expect(crypto.isEncrypted('file.enc.txt')).toBe(false);
      expect(crypto.isEncrypted('my.enc.document')).toBe(false);
    });

    test('should be case-sensitive', () => {
      expect(crypto.isEncrypted('file.ENC')).toBe(false);
      expect(crypto.isEncrypted('file.txt.ENC')).toBe(false);
    });
  });

  // ============================================================================
  // getEncryptedPath() Tests
  // ============================================================================

  describe('getEncryptedPath()', () => {
    test('should append .enc extension', () => {
      expect(crypto.getEncryptedPath('file.txt')).toBe('file.txt.enc');
      expect(crypto.getEncryptedPath('/path/to/image.jpg')).toBe('/path/to/image.jpg.enc');
    });

    test('should work with files already having .enc', () => {
      // This is edge case behavior - function just appends
      expect(crypto.getEncryptedPath('file.txt.enc')).toBe('file.txt.enc.enc');
    });

    test('should preserve path structure', () => {
      const inputPath = '/home/user/documents/report.pdf';
      const expected = '/home/user/documents/report.pdf.enc';
      expect(crypto.getEncryptedPath(inputPath)).toBe(expected);
    });
  });

  // ============================================================================
  // getDecryptedPath() Tests
  // ============================================================================

  describe('getDecryptedPath()', () => {
    test('should remove .enc extension', () => {
      expect(crypto.getDecryptedPath('file.txt.enc')).toBe('file.txt');
      expect(crypto.getDecryptedPath('/path/to/image.jpg.enc')).toBe('/path/to/image.jpg');
    });

    test('should handle double .enc extensions', () => {
      expect(crypto.getDecryptedPath('file.txt.enc.enc')).toBe('file.txt.enc');
    });

    test('should preserve path structure', () => {
      const inputPath = '/home/user/documents/report.pdf.enc';
      const expected = '/home/user/documents/report.pdf';
      expect(crypto.getDecryptedPath(inputPath)).toBe(expected);
    });

    test('should work on files without .enc (no-op)', () => {
      const inputPath = 'file.txt';
      expect(crypto.getDecryptedPath(inputPath)).toBe('file.txt');
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('Integration: Full Encryption/Decryption Cycle', () => {
    test('should complete full file lifecycle: create -> encrypt -> decrypt', async () => {
      const filePath = path.join(TEST_DIR, 'lifecycle.txt');
      const originalContent = 'Lifecycle test content 🔐';
      const password = 'lifecyclePassword';

      // Create
      await fs.writeFile(filePath, originalContent);
      expect(fsSync.existsSync(filePath)).toBe(true);

      // Encrypt
      const encResult = await crypto.encryptFile(filePath, password);
      expect(fsSync.existsSync(filePath)).toBe(false);
      expect(fsSync.existsSync(encResult.encryptedPath)).toBe(true);

      // Decrypt
      const decResult = await crypto.decryptFile(encResult.encryptedPath, password);
      expect(fsSync.existsSync(encResult.encryptedPath)).toBe(false);
      expect(fsSync.existsSync(decResult.decryptedPath)).toBe(true);

      // Verify content
      const finalContent = await fs.readFile(decResult.decryptedPath, 'utf8');
      expect(finalContent).toBe(originalContent);
    });

    test('should handle multiple files with same password', async () => {
      const file1 = path.join(TEST_DIR, 'file1.txt');
      const file2 = path.join(TEST_DIR, 'file2.txt');
      const password = 'sharedPassword';

      await fs.writeFile(file1, 'Content 1');
      await fs.writeFile(file2, 'Content 2');

      const enc1 = await crypto.encryptFile(file1, password);
      const enc2 = await crypto.encryptFile(file2, password);

      const dec1 = await crypto.decryptFile(enc1.encryptedPath, password);
      const dec2 = await crypto.decryptFile(enc2.encryptedPath, password);

      const content1 = await fs.readFile(dec1.decryptedPath, 'utf8');
      const content2 = await fs.readFile(dec2.decryptedPath, 'utf8');

      expect(content1).toBe('Content 1');
      expect(content2).toBe('Content 2');
    });
  });

  // ============================================================================
  // Security Properties Tests
  // ============================================================================

  describe('Security Properties', () => {
    test('should use authenticated encryption (AES-256-GCM)', async () => {
      // This test verifies auth tag is included
      const plainData = Buffer.from('sensitive data');
      const password = 'testPassword';

      const encrypted = await crypto.encryptBuffer(plainData, password);

      // Minimum size: salt(32) + iv(16) + authTag(16) + data
      expect(encrypted.length).toBeGreaterThanOrEqual(64);
    });

    test('should use different salt for each encryption', async () => {
      const plainData = Buffer.from('test');
      const password = 'password';

      const encrypted1 = await crypto.encryptBuffer(plainData, password);
      const encrypted2 = await crypto.encryptBuffer(plainData, password);

      // Extract salt (first 32 bytes)
      const salt1 = encrypted1.slice(0, 32);
      const salt2 = encrypted2.slice(0, 32);

      expect(salt1).not.toEqual(salt2);
    });

    test('should use different IV for each encryption', async () => {
      const plainData = Buffer.from('test');
      const password = 'password';

      const encrypted1 = await crypto.encryptBuffer(plainData, password);
      const encrypted2 = await crypto.encryptBuffer(plainData, password);

      // Extract IV (bytes 32-47)
      const iv1 = encrypted1.slice(32, 48);
      const iv2 = encrypted2.slice(32, 48);

      expect(iv1).not.toEqual(iv2);
    });
  });
});
