/**
 * Portfolio Vault Unit Tests
 * 
 * Tests for PortfolioVault module which handles encrypted vault operations
 * for storing and managing encrypted portfolio files.
 * 
 * @module tests/unit/portfolio-vault.test.js
 */

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { PortfolioVault } = require('../../src/portfolio-vault');

/**
 * Test directories (temporary, cleaned up after tests)
 */
const TEST_BASE_DIR = path.join(__dirname, '..', '__test_fixtures__', 'portfolio-vault');
const PORTFOLIOS_DIR = path.join(TEST_BASE_DIR, 'portfolios');
const DATA_DIR = path.join(TEST_BASE_DIR, 'data');

/**
 * Helper to clean test directories
 */
async function cleanupTestDirs() {
  try {
    if (fsSync.existsSync(TEST_BASE_DIR)) {
      await fs.rm(TEST_BASE_DIR, { recursive: true, force: true });
    }
  } catch (error) {
    // Silently ignore cleanup errors
  }
}

/**
 * Helper to create test directories
 */
async function setupTestDirs() {
  await fs.mkdir(PORTFOLIOS_DIR, { recursive: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
}

/**
 * Helper to create test portfolio structure
 */
async function createTestPortfolios() {
  // Student 1: Math portfolio with images
  const student1Dir = path.join(PORTFOLIOS_DIR, 'Student_John_1', 'Mathematics');
  await fs.mkdir(student1Dir, { recursive: true });
  await fs.writeFile(path.join(student1Dir, 'exam1.jpg'), 'fake jpg content 1');
  await fs.writeFile(path.join(student1Dir, 'exam2.png'), 'fake png content 2');

  // Student 2: Language portfolio
  const student2Dir = path.join(PORTFOLIOS_DIR, 'Student_Maria_2', 'Language');
  await fs.mkdir(student2Dir, { recursive: true });
  await fs.writeFile(path.join(student2Dir, 'essay.jpg'), 'fake jpg content 3');

  // Temporal folder (should be ignored)
  const tempDir = path.join(PORTFOLIOS_DIR, '_temporal_');
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(path.join(tempDir, 'temp.jpg'), 'temporary file');

  // Non-image files (should be ignored)
  await fs.writeFile(path.join(PORTFOLIOS_DIR, 'readme.txt'), 'text file');
  await fs.writeFile(path.join(PORTFOLIOS_DIR, 'notes.md'), 'markdown file');
}

describe('PortfolioVault Class', () => {
  let vault;

  beforeEach(async () => {
    await setupTestDirs();
    await createTestPortfolios();
    vault = new PortfolioVault(PORTFOLIOS_DIR, DATA_DIR);
  });

  afterEach(async () => {
    await cleanupTestDirs();
  });

  // ============================================================================
  // isLocked() Tests
  // ============================================================================

  describe('isLocked()', () => {
    test('should return false when no vault state file exists', async () => {
      const result = await vault.isLocked();
      expect(result).toBe(false);
    });

    test('should return true when vault is locked', async () => {
      await vault.setLockState(true);
      const result = await vault.isLocked();
      expect(result).toBe(true);
    });

    test('should return false when vault is explicitly unlocked', async () => {
      await vault.setLockState(true);
      await vault.setLockState(false);
      const result = await vault.isLocked();
      expect(result).toBe(false);
    });

    test('should handle corrupted state file gracefully', async () => {
      // Write invalid JSON to state file
      const stateFile = path.join(DATA_DIR, '.vault_state');
      await fs.writeFile(stateFile, 'invalid json content');

      const result = await vault.isLocked();
      expect(result).toBe(false);
    });
  });

  // ============================================================================
  // setLockState() Tests
  // ============================================================================

  describe('setLockState()', () => {
    test('should set vault state to locked', async () => {
      await vault.setLockState(true);
      const locked = await vault.isLocked();
      expect(locked).toBe(true);
    });

    test('should set vault state to unlocked', async () => {
      await vault.setLockState(true);
      await vault.setLockState(false);
      const locked = await vault.isLocked();
      expect(locked).toBe(false);
    });

    test('should create vault state file if it does not exist', async () => {
      const stateFile = path.join(DATA_DIR, '.vault_state');
      expect(fsSync.existsSync(stateFile)).toBe(false);

      await vault.setLockState(true);
      expect(fsSync.existsSync(stateFile)).toBe(true);
    });

    test('should store timestamp in state file', async () => {
      await vault.setLockState(true);

      const stateFile = path.join(DATA_DIR, '.vault_state');
      const content = await fs.readFile(stateFile, 'utf8');
      const state = JSON.parse(content);

      expect(state.timestamp).toBeDefined();
      expect(typeof state.timestamp).toBe('string');
      expect(new Date(state.timestamp)).toBeInstanceOf(Date);
    });

    test('should store locked boolean in state file', async () => {
      await vault.setLockState(true);

      const stateFile = path.join(DATA_DIR, '.vault_state');
      const content = await fs.readFile(stateFile, 'utf8');
      const state = JSON.parse(content);

      expect(state.locked).toBe(true);
    });
  });

  // ============================================================================
  // getAllImageFiles() Tests
  // ============================================================================

  describe('getAllImageFiles()', () => {
    test('should find all image files in portfolios', async () => {
      const files = await vault.getAllImageFiles();

      expect(files.length).toBeGreaterThan(0);
      expect(files.some(f => f.endsWith('exam1.jpg'))).toBe(true);
      expect(files.some(f => f.endsWith('exam2.png'))).toBe(true);
      expect(files.some(f => f.endsWith('essay.jpg'))).toBe(true);
    });

    test('should ignore _temporal_ folder', async () => {
      const files = await vault.getAllImageFiles();

      const hasTemporalFiles = files.some(f => f.includes('_temporal_'));
      expect(hasTemporalFiles).toBe(false);
    });

    test('should ignore non-image files', async () => {
      const files = await vault.getAllImageFiles();

      expect(files.every(f => {
        const ext = path.extname(f).toLowerCase();
        return ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.enc';
      })).toBe(true);
    });

    test('should find encrypted files (.enc)', async () => {
      // Create an encrypted file
      const encFile = path.join(PORTFOLIOS_DIR, 'Student_John_1', 'test.jpg.enc');
      await fs.writeFile(encFile, 'encrypted content');

      const files = await vault.getAllImageFiles();

      expect(files.some(f => f.endsWith('.enc'))).toBe(true);
    });

    test('should return absolute paths', async () => {
      const files = await vault.getAllImageFiles();

      expect(files.length).toBeGreaterThan(0);
      expect(path.isAbsolute(files[0])).toBe(true);
    });

    test('should handle empty portfolios directory', async () => {
      // Create new vault with empty directory
      const emptyDir = path.join(TEST_BASE_DIR, 'empty-portfolios');
      await fs.mkdir(emptyDir, { recursive: true });

      const emptyVault = new PortfolioVault(emptyDir, DATA_DIR);
      const files = await emptyVault.getAllImageFiles();

      expect(files.length).toBe(0);
    });
  });

  // ============================================================================
  // lockVault() Tests
  // ============================================================================

  describe('lockVault()', () => {
    test('should encrypt unencrypted files', async () => {
      const password = 'lockPassword123';

      const result = await vault.lockVault(password);

      expect(result.success).toBe(true);
      expect(result.filesEncrypted).toBeGreaterThan(0);
      expect(result.errors.length).toBe(0);
    });

    test('should set vault state to locked after encryption', async () => {
      const password = 'lockPassword';
      await vault.lockVault(password);

      const locked = await vault.isLocked();
      expect(locked).toBe(true);
    });

    test('should not re-encrypt already encrypted files', async () => {
      const password = 'lockPassword';

      // First lock
      const result1 = await vault.lockVault(password);
      const filesEncrypted1 = result1.filesEncrypted;

      // Second lock should report 0 files encrypted (already locked)
      const result2 = await vault.lockVault(password);

      expect(result2.success).toBe(false); // Already locked
      expect(result2.filesEncrypted).toBe(0);
    });

    test('should fail if vault is already locked', async () => {
      const password = 'lockPassword';

      await vault.lockVault(password);
      const result = await vault.lockVault(password);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Vault is already locked');
    });

    test('should report encryption count', async () => {
      const password = 'lockPassword';

      const result = await vault.lockVault(password);

      expect(result.filesEncrypted).toBe(3); // 3 non-encrypted image files
    });

    test('should delete original files after encryption', async () => {
      const password = 'lockPassword';
      const originalFile = path.join(PORTFOLIOS_DIR, 'Student_John_1', 'Mathematics', 'exam1.jpg');

      expect(fsSync.existsSync(originalFile)).toBe(true);

      await vault.lockVault(password);

      expect(fsSync.existsSync(originalFile)).toBe(false);
      expect(fsSync.existsSync(originalFile + '.enc')).toBe(true);
    });

    test('should handle encryption errors gracefully', async () => {
      const password = 'lockPassword';

      // Create a directory with same name as an image file (will cause error)
      const conflictFile = path.join(PORTFOLIOS_DIR, 'Student_John_1', 'Mathematics', 'exam2.png');
      const examFile = await fs.readFile(conflictFile);
      await fs.unlink(conflictFile);
      await fs.mkdir(conflictFile);

      const result = await vault.lockVault(password);

      // Should report errors but still succeed with other files
      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.filesEncrypted).toBeLessThan(3);

      // Clean up
      await fs.rm(conflictFile, { recursive: true });
    });
  });

  // ============================================================================
  // unlockVault() Tests
  // ============================================================================

  describe('unlockVault()', () => {
    test('should decrypt encrypted files', async () => {
      const password = 'unlockPassword123';

      // First lock
      await vault.lockVault(password);

      // Then unlock
      const result = await vault.unlockVault(password);

      expect(result.success).toBe(true);
      expect(result.filesDecrypted).toBeGreaterThan(0);
    });

    test('should restore original files', async () => {
      const password = 'unlockPassword';

      const originalFile = path.join(PORTFOLIOS_DIR, 'Student_John_1', 'Mathematics', 'exam1.jpg');

      // Lock
      await vault.lockVault(password);
      expect(fsSync.existsSync(originalFile)).toBe(false);
      expect(fsSync.existsSync(originalFile + '.enc')).toBe(true);

      // Unlock
      await vault.unlockVault(password);

      expect(fsSync.existsSync(originalFile)).toBe(true);
      expect(fsSync.existsSync(originalFile + '.enc')).toBe(false);
    });

    test('should set vault state to unlocked if successful', async () => {
      const password = 'unlockPassword';

      await vault.lockVault(password);
      await vault.unlockVault(password);

      const locked = await vault.isLocked();
      expect(locked).toBe(false);
    });

    test('should not fail with wrong password', async () => {
      const correctPassword = 'correct';
      const wrongPassword = 'wrong';

      await vault.lockVault(correctPassword);

      const result = await vault.unlockVault(wrongPassword);

      // Decryption will fail for all files
      expect(result.filesDecrypted).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should handle already unlocked vault', async () => {
      const password = 'unlockPassword';

      const result = await vault.unlockVault(password);

      // Should succeed even with no files to decrypt
      expect(result.success).toBe(true);
      expect(result.filesDecrypted).toBe(0);
    });

    test('should preserve file content through lock/unlock cycle', async () => {
      const password = 'cyclePassword';
      const testFile = path.join(PORTFOLIOS_DIR, 'Student_John_1', 'Mathematics', 'exam1.jpg');
      const originalContent = await fs.readFile(testFile);

      // Lock
      await vault.lockVault(password);

      // Unlock
      await vault.unlockVault(password);

      // Verify content
      const finalContent = await fs.readFile(testFile);
      expect(finalContent).toEqual(originalContent);
    });
  });

  // ============================================================================
  // encryptNewFile() Tests
  // ============================================================================

  describe('encryptNewFile()', () => {
    test('should encrypt file when vault is locked', async () => {
      const password = 'newFilePassword';
      await vault.lockVault(password);

      const newFile = path.join(PORTFOLIOS_DIR, 'Student_John_1', 'Mathematics', 'new_exam.jpg');
      await fs.writeFile(newFile, 'new exam content');

      const result = await vault.encryptNewFile(newFile, password);

      expect(result.success).toBe(true);
      expect(result.encrypted).toBe(true);
      expect(fsSync.existsSync(newFile)).toBe(false);
      expect(fsSync.existsSync(newFile + '.enc')).toBe(true);
    });

    test('should not encrypt file when vault is unlocked', async () => {
      const newFile = path.join(PORTFOLIOS_DIR, 'Student_John_1', 'Mathematics', 'new_exam.jpg');
      await fs.writeFile(newFile, 'new exam content');

      const result = await vault.encryptNewFile(newFile, 'anyPassword');

      expect(result.success).toBe(true);
      expect(result.encrypted).toBe(false);
      expect(fsSync.existsSync(newFile)).toBe(true);
    });

    test('should return encrypted: false when vault is unlocked', async () => {
      const newFile = path.join(PORTFOLIOS_DIR, 'test.jpg');
      await fs.writeFile(newFile, 'content');

      const result = await vault.encryptNewFile(newFile, 'password');

      expect(result.encrypted).toBe(false);
    });
  });

  // ============================================================================
  // getStats() Tests
  // ============================================================================

  describe('getStats()', () => {
    test('should return vault statistics', async () => {
      const stats = await vault.getStats();

      expect(stats.locked).toBe(false);
      expect(stats.totalFiles).toBe(3);
      expect(stats.encryptedFiles).toBe(0);
      expect(stats.unencryptedFiles).toBe(3);
    });

    test('should show 0 encrypted files when unlocked', async () => {
      const stats = await vault.getStats();

      expect(stats.encryptedFiles).toBe(0);
      expect(stats.unencryptedFiles).toBeGreaterThan(0);
    });

    test('should show encrypted count after locking', async () => {
      const password = 'statsPassword';
      await vault.lockVault(password);

      const stats = await vault.getStats();

      expect(stats.encryptedFiles).toBe(3);
      expect(stats.unencryptedFiles).toBe(0);
      expect(stats.locked).toBe(true);
    });

    test('should update stats after lock/unlock cycle', async () => {
      const password = 'statsPassword';

      // Initial state
      let stats = await vault.getStats();
      expect(stats.locked).toBe(false);
      expect(stats.encryptedFiles).toBe(0);

      // After lock
      await vault.lockVault(password);
      stats = await vault.getStats();
      expect(stats.locked).toBe(true);
      expect(stats.encryptedFiles).toBe(3);

      // After unlock
      await vault.unlockVault(password);
      stats = await vault.getStats();
      expect(stats.locked).toBe(false);
      expect(stats.encryptedFiles).toBe(0);
    });

    test('should return total files count correctly', async () => {
      const stats = await vault.getStats();

      expect(stats.totalFiles).toBe(stats.encryptedFiles + stats.unencryptedFiles);
    });

    test('should handle empty vault', async () => {
      const emptyDir = path.join(TEST_BASE_DIR, 'empty-portfolios');
      await fs.mkdir(emptyDir, { recursive: true });

      const emptyVault = new PortfolioVault(emptyDir, DATA_DIR);
      const stats = await emptyVault.getStats();

      expect(stats.totalFiles).toBe(0);
      expect(stats.encryptedFiles).toBe(0);
      expect(stats.unencryptedFiles).toBe(0);
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('Integration: Vault Lifecycle', () => {
    test('should complete full vault lifecycle', async () => {
      const password = 'lifecyclePassword';

      // 1. Initial state - vault unlocked
      let stats = await vault.getStats();
      expect(stats.locked).toBe(false);
      expect(stats.unencryptedFiles).toBe(3);

      // 2. Lock vault
      const lockResult = await vault.lockVault(password);
      expect(lockResult.success).toBe(true);
      expect(lockResult.filesEncrypted).toBe(3);

      stats = await vault.getStats();
      expect(stats.locked).toBe(true);
      expect(stats.encryptedFiles).toBe(3);

      // 3. Unlock vault
      const unlockResult = await vault.unlockVault(password);
      expect(unlockResult.success).toBe(true);
      expect(unlockResult.filesDecrypted).toBe(3);

      stats = await vault.getStats();
      expect(stats.locked).toBe(false);
      expect(stats.unencryptedFiles).toBe(3);
    });

    test('should handle multiple lock/unlock cycles', async () => {
      const password = 'cyclePassword';

      for (let i = 0; i < 3; i++) {
        // Lock
        let result = await vault.lockVault(password);
        expect(result.success).toBe(true);

        let stats = await vault.getStats();
        expect(stats.locked).toBe(true);

        // Unlock
        result = await vault.unlockVault(password);
        expect(result.success).toBe(true);

        stats = await vault.getStats();
        expect(stats.locked).toBe(false);
      }
    });
  });
});
