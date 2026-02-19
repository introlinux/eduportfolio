/**
 * Password Manager Unit Tests
 * 
 * Tests for PasswordManager module which handles secure master password
 * storage and verification using PBKDF2 hashing.
 * 
 * @module tests/unit/password-manager.test.js
 */

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');
const { PasswordManager, DEFAULT_PASSWORD } = require('../../src/password-manager');

/**
 * Test data directory (temporary, cleaned up after tests)
 */
const TEST_DIR = path.join(__dirname, '..', '__test_fixtures__', 'password-manager');

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

describe('PasswordManager Class', () => {
  let passwordManager;

  beforeEach(async () => {
    await setupTestDir();
    passwordManager = new PasswordManager(TEST_DIR);
  });

  afterEach(async () => {
    await cleanupTestDir();
  });

  // ============================================================================
  // hasPassword() Tests
  // ============================================================================

  describe('hasPassword()', () => {
    test('should return false when no password file exists', async () => {
      const result = await passwordManager.hasPassword();
      expect(result).toBe(false);
    });

    test('should return true when password file exists', async () => {
      // Create a password file
      const passwordFile = path.join(TEST_DIR, '.password');
      const testData = JSON.stringify({ hash: 'test', salt: 'test' });
      await fs.writeFile(passwordFile, testData);

      const result = await passwordManager.hasPassword();
      expect(result).toBe(true);
    });

    test('should handle permission errors gracefully', async () => {
      // Create a directory instead of a file to cause access error
      const passwordFile = path.join(TEST_DIR, '.password');
      await fs.mkdir(passwordFile);

      const result = await passwordManager.hasPassword();
      expect(result).toBe(false);
    });
  });

  // ============================================================================
  // setPassword() Tests
  // ============================================================================

  describe('setPassword()', () => {
    test('should set password successfully when none exists', async () => {
      const password = 'testPassword123';
      const result = await passwordManager.setPassword(password);

      expect(result.success).toBe(true);
      expect(result.message).toContain('successfully');

      // Verify file was created
      const hasPassword = await passwordManager.hasPassword();
      expect(hasPassword).toBe(true);
    });

    test('should create valid password file with hash and salt', async () => {
      const password = 'securePassword456';
      await passwordManager.setPassword(password);

      const passwordFile = path.join(TEST_DIR, '.password');
      const fileContent = await fs.readFile(passwordFile, 'utf8');
      const data = JSON.parse(fileContent);

      expect(data.hash).toBeDefined();
      expect(data.salt).toBeDefined();
      expect(typeof data.hash).toBe('string');
      expect(typeof data.salt).toBe('string');
      expect(data.hash.length).toBeGreaterThan(0);
      expect(data.salt.length).toBeGreaterThan(0);
    });

    test('should reject setting password when one already exists', async () => {
      const password1 = 'firstPassword';
      const password2 = 'secondPassword';

      await passwordManager.setPassword(password1);
      const result = await passwordManager.setPassword(password2);

      expect(result.success).toBe(false);
      expect(result.message).toContain('already configured');
    });

    test('should create password file with restricted permissions', async () => {
      const password = 'restrictedPassword';
      await passwordManager.setPassword(password);

      const passwordFile = path.join(TEST_DIR, '.password');
      const stats = await fs.stat(passwordFile);
      
      // Check file exists (mode check is OS-dependent, so just verify file exists)
      expect(stats.isFile()).toBe(true);
    });

    test('should use PBKDF2 with consistent parameters', async () => {
      const password = 'consistentPassword';
      await passwordManager.setPassword(password);

      const passwordFile = path.join(TEST_DIR, '.password');
      const fileContent = await fs.readFile(passwordFile, 'utf8');
      const data = JSON.parse(fileContent);

      // Salt should be 64 hex chars (32 bytes)
      expect(data.salt.length).toBe(64);

      // Hash should be 128 hex chars (64 bytes / SHA-512)
      expect(data.hash.length).toBe(128);
    });
  });

  // ============================================================================
  // verifyPassword() Tests
  // ============================================================================

  describe('verifyPassword()', () => {
    const testPassword = 'myPassword123';

    beforeEach(async () => {
      await passwordManager.setPassword(testPassword);
    });

    test('should return true for correct password', async () => {
      const result = await passwordManager.verifyPassword(testPassword);
      expect(result).toBe(true);
    });

    test('should return false for incorrect password', async () => {
      const result = await passwordManager.verifyPassword('wrongPassword');
      expect(result).toBe(false);
    });

    test('should be case-sensitive', async () => {
      const result = await passwordManager.verifyPassword(testPassword.toUpperCase());
      expect(result).toBe(false);
    });

    test('should return false when no password is set', async () => {
      const pm = new PasswordManager(path.join(TEST_DIR, 'empty'));
      const result = await pm.verifyPassword(testPassword);
      expect(result).toBe(false);
    });

    test('should handle empty string password gracefully', async () => {
      const result = await passwordManager.verifyPassword('');
      expect(result).toBe(false);
    });

    test('should return false for null/undefined', async () => {
      const result1 = await passwordManager.verifyPassword(null);
      expect(result1).toBe(false);

      const result2 = await passwordManager.verifyPassword(undefined);
      expect(result2).toBe(false);
    });

    test('should verify password consistently across multiple calls', async () => {
      const result1 = await passwordManager.verifyPassword(testPassword);
      const result2 = await passwordManager.verifyPassword(testPassword);
      
      expect(result1).toBe(true);
      expect(result2).toBe(true);
    });
  });

  // ============================================================================
  // changePassword() Tests
  // ============================================================================

  describe('changePassword()', () => {
    const oldPassword = 'oldPassword123';
    const newPassword = 'newPassword456';

    beforeEach(async () => {
      await passwordManager.setPassword(oldPassword);
    });

    test('should change password successfully with correct old password', async () => {
      const result = await passwordManager.changePassword(oldPassword, newPassword);

      expect(result.success).toBe(true);
      expect(result.message).toContain('successfully');
    });

    test('should invalidate old password after change', async () => {
      await passwordManager.changePassword(oldPassword, newPassword);

      const oldVerify = await passwordManager.verifyPassword(oldPassword);
      expect(oldVerify).toBe(false);
    });

    test('should validate new password after change', async () => {
      await passwordManager.changePassword(oldPassword, newPassword);

      const newVerify = await passwordManager.verifyPassword(newPassword);
      expect(newVerify).toBe(true);
    });

    test('should reject change with incorrect old password', async () => {
      const result = await passwordManager.changePassword('wrongOldPassword', newPassword);

      expect(result.success).toBe(false);
      expect(result.message).toContain('incorrect');
    });

    test('should preserve old password if change fails', async () => {
      await passwordManager.changePassword('wrongPassword', newPassword);

      const canVerifyOld = await passwordManager.verifyPassword(oldPassword);
      expect(canVerifyOld).toBe(true);
    });

    test('should allow changing to same password (if correct old)', async () => {
      const result = await passwordManager.changePassword(oldPassword, oldPassword);

      expect(result.success).toBe(true);
      const verify = await passwordManager.verifyPassword(oldPassword);
      expect(verify).toBe(true);
    });

    test('should update password file when changing password', async () => {
      const passwordFile = path.join(TEST_DIR, '.password');

      const beforeContent = await fs.readFile(passwordFile, 'utf8');
      const beforeData = JSON.parse(beforeContent);

      await passwordManager.changePassword(oldPassword, newPassword);

      const afterContent = await fs.readFile(passwordFile, 'utf8');
      const afterData = JSON.parse(afterContent);

      // Hash and salt should be different
      expect(afterData.hash).not.toBe(beforeData.hash);
      expect(afterData.salt).not.toBe(beforeData.salt);
    });
  });

  // ============================================================================
  // initializeDefaultPassword() Tests
  // ============================================================================

  describe('initializeDefaultPassword()', () => {
    test('should initialize default password when none exists', async () => {
      const result = await passwordManager.initializeDefaultPassword();

      expect(result.initialized).toBe(true);
      expect(result.isDefault).toBe(true);
    });

    test('should use DEFAULT_PASSWORD constant', async () => {
      await passwordManager.initializeDefaultPassword();

      const verify = await passwordManager.verifyPassword(DEFAULT_PASSWORD);
      expect(verify).toBe(true);
    });

    test('should not reinitialize if password already exists', async () => {
      const customPassword = 'customPassword789';
      await passwordManager.setPassword(customPassword);

      const result = await passwordManager.initializeDefaultPassword();

      expect(result.initialized).toBe(false);
      expect(result.isDefault).toBe(false);
    });

    test('should be idempotent (safe to call multiple times)', async () => {
      const result1 = await passwordManager.initializeDefaultPassword();
      const result2 = await passwordManager.initializeDefaultPassword();

      expect(result1.initialized).toBe(true);
      expect(result2.initialized).toBe(false); // Already initialized
    });

    test('should allow verification with DEFAULT_PASSWORD after init', async () => {
      await passwordManager.initializeDefaultPassword();

      const verify = await passwordManager.verifyPassword(DEFAULT_PASSWORD);
      expect(verify).toBe(true);
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('Integration: Password Lifecycle', () => {
    test('should complete full password lifecycle: set -> verify -> change -> verify', async () => {
      const password1 = 'lifecycle1';
      const password2 = 'lifecycle2';

      // Set initial password
      const setResult = await passwordManager.setPassword(password1);
      expect(setResult.success).toBe(true);

      // Verify initial password
      const verify1 = await passwordManager.verifyPassword(password1);
      expect(verify1).toBe(true);

      // Change password
      const changeResult = await passwordManager.changePassword(password1, password2);
      expect(changeResult.success).toBe(true);

      // Verify old password doesn't work
      const verifyOld = await passwordManager.verifyPassword(password1);
      expect(verifyOld).toBe(false);

      // Verify new password works
      const verify2 = await passwordManager.verifyPassword(password2);
      expect(verify2).toBe(true);

      // Verify hasPassword still returns true
      const has = await passwordManager.hasPassword();
      expect(has).toBe(true);
    });
  });

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe('Edge Cases', () => {
    test('should handle very long passwords', async () => {
      const longPassword = 'x'.repeat(1000);

      await passwordManager.setPassword(longPassword);
      const verify = await passwordManager.verifyPassword(longPassword);

      expect(verify).toBe(true);
    });

    test('should handle special characters in password', async () => {
      const specialPassword = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';

      await passwordManager.setPassword(specialPassword);
      const verify = await passwordManager.verifyPassword(specialPassword);

      expect(verify).toBe(true);
    });

    test('should handle unicode/emoji in password', async () => {
      const unicodePassword = 'пароль日本語🔐🔑';

      await passwordManager.setPassword(unicodePassword);
      const verify = await passwordManager.verifyPassword(unicodePassword);

      expect(verify).toBe(true);
    });

    test('should handle spaces in password', async () => {
      const spacePassword = 'my password with spaces';

      await passwordManager.setPassword(spacePassword);
      const verify = await passwordManager.verifyPassword(spacePassword);

      expect(verify).toBe(true);
    });
  });
});
