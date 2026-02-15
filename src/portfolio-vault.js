/**
 * Portfolio Vault - Encrypted Portfolio Vault Management
 *
 * Module responsible for encrypting/decrypting the complete portfolios folder
 * and managing vault state (locked/unlocked).
 *
 * @module portfolio-vault
 * @author Antonio Sánchez León
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('./crypto-manager');

// Supported image file extensions
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const TEMPORAL_FOLDER_NAME = '_temporal_';

/**
 * Class for managing the encrypted portfolios vault
 */
class PortfolioVault {
    /**
     * @param {string} portfoliosDir - Portfolios directory
     * @param {string} dataDir - Data directory (for state file)
     */
    constructor(portfoliosDir, dataDir) {
        this.portfoliosDir = portfoliosDir;
        this.dataDir = dataDir;
        this.vaultStatePath = path.join(dataDir, '.vault_state');
    }

    /**
     * Checks if the vault is locked (files encrypted)
     *
     * @returns {Promise<boolean>}
     */
    async isLocked() {
        try {
            const state = await fs.readFile(this.vaultStatePath, 'utf8');
            const { locked } = JSON.parse(state);
            return locked === true;
        } catch {
            return false;
        }
    }

    /**
     * Sets the vault lock state
     *
     * @param {boolean} locked - true if locked, false if unlocked
     * @returns {Promise<void>}
     */
    async setLockState(locked) {
        const state = JSON.stringify({ locked, timestamp: new Date().toISOString() }, null, 2);
        await fs.writeFile(this.vaultStatePath, state);
    }

    /**
     * Gets all image files in the portfolios folder
     *
     * @param {string} dir - Directory to scan
     * @param {string[]} fileList - Accumulative file list
     * @returns {Promise<string[]>} List of absolute file paths
     */
    async getAllImageFiles(dir = this.portfoliosDir, fileList = []) {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (entry.name === TEMPORAL_FOLDER_NAME) {
                    continue;
                }
                await this.getAllImageFiles(fullPath, fileList);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                const isImageFile = IMAGE_EXTENSIONS.includes(ext) || ext === crypto.ENCRYPTED_EXTENSION;

                if (isImageFile) {
                    fileList.push(fullPath);
                }
            }
        }

        return fileList;
    }

    /**
     * Locks the vault by encrypting all portfolio files
     *
     * @param {string} password - Password for encryption
     * @returns {Promise<{success: boolean, filesEncrypted: number, errors: string[]}>}
     */
    async lockVault(password) {
        if (await this.isLocked()) {
            return { success: false, filesEncrypted: 0, errors: ['Vault is already locked'] };
        }

        const files = await this.getAllImageFiles();
        const errors = [];
        let filesEncrypted = 0;

        for (const filePath of files) {
            if (crypto.isEncrypted(filePath)) {
                continue;
            }

            try {
                await crypto.encryptFile(filePath, password);
                filesEncrypted++;
            } catch (error) {
                errors.push(`Error encrypting ${filePath}: ${error.message}`);
            }
        }

        await this.setLockState(true);

        return { success: true, filesEncrypted, errors };
    }

    /**
     * Unlocks the vault by decrypting all portfolio files
     *
     * @param {string} password - Password for decryption
     * @returns {Promise<{success: boolean, filesDecrypted: number, errors: string[]}>}
     */
    async unlockVault(password) {
        const files = await this.getAllImageFiles();
        const errors = [];
        let filesDecrypted = 0;

        for (const filePath of files) {
            if (!crypto.isEncrypted(filePath)) {
                continue;
            }

            try {
                await crypto.decryptFile(filePath, password);
                filesDecrypted++;
            } catch (error) {
                errors.push(`Error decrypting ${filePath}: ${error.message}`);
            }
        }

        if (errors.length === 0) {
            await this.setLockState(false);
            return { success: true, filesDecrypted, errors };
        }

        return { success: false, filesDecrypted, errors };
    }

    /**
     * Encrypts a newly saved file (only if vault is locked)
     *
     * @param {string} filePath - Path to file to encrypt
     * @param {string} password - Password for encryption
     * @returns {Promise<{success: boolean, encrypted: boolean}>}
     */
    async encryptNewFile(filePath, password) {
        if (!await this.isLocked()) {
            return { success: true, encrypted: false };
        }

        try {
            await crypto.encryptFile(filePath, password);
            return { success: true, encrypted: true };
        } catch (error) {
            return { success: false, encrypted: false };
        }
    }

    /**
     * Gets vault statistics
     *
     * @returns {Promise<{locked: boolean, totalFiles: number, encryptedFiles: number, unencryptedFiles: number}>}
     */
    async getStats() {
        const locked = await this.isLocked();
        const files = await this.getAllImageFiles();

        const encryptedFiles = files.filter(f => crypto.isEncrypted(f)).length;
        const unencryptedFiles = files.filter(f => !crypto.isEncrypted(f)).length;

        return {
            locked,
            totalFiles: files.length,
            encryptedFiles,
            unencryptedFiles
        };
    }
}

module.exports = { PortfolioVault };
