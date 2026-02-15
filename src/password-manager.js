/**
 * Password Manager - Master Password Management
 *
 * Module responsible for securely storing and verifying the master password
 * using PBKDF2 hashing algorithm.
 *
 * @module password-manager
 * @author Antonio Sánchez León
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

// Security configuration constants
const PBKDF2_ITERATIONS = 100000;
const HASH_LENGTH = 64; // 512 bits
const SALT_LENGTH = 32; // 256 bits
const PBKDF2_DIGEST = 'sha512';
const PASSWORD_FILE_PERMISSIONS = 0o600; // Owner read/write only

// Default password
const DEFAULT_PASSWORD = 'eduportfolio';

/**
 * Generates a secure hash of a password using PBKDF2
 *
 * @param {string} password - Password to hash
 * @param {Buffer} [salt] - Optional salt (generated if not provided)
 * @returns {Promise<{hash: string, salt: string}>}
 */
function hashPassword(password, salt = null) {
    return new Promise((resolve, reject) => {
        const passwordSalt = salt || crypto.randomBytes(SALT_LENGTH);

        crypto.pbkdf2(
            password,
            passwordSalt,
            PBKDF2_ITERATIONS,
            HASH_LENGTH,
            PBKDF2_DIGEST,
            (err, derivedKey) => {
                if (err) {
                    reject(err);
                    return;
                }

                resolve({
                    hash: derivedKey.toString('hex'),
                    salt: passwordSalt.toString('hex')
                });
            }
        );
    });
}

/**
 * Class for managing the master password
 */
class PasswordManager {
    /**
     * @param {string} dataDir - Directory where the password file is stored
     */
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.passwordFilePath = path.join(dataDir, '.password');
    }

    /**
     * Checks if a password is configured
     *
     * @returns {Promise<boolean>}
     */
    async hasPassword() {
        try {
            await fs.access(this.passwordFilePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Sets the initial password (only if none exists)
     *
     * @param {string} password - New password
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async setPassword(password) {
        if (await this.hasPassword()) {
            return { success: false, message: 'Password already configured' };
        }

        const { hash, salt } = await hashPassword(password);
        const data = JSON.stringify({ hash, salt }, null, 2);

        await fs.writeFile(this.passwordFilePath, data, { mode: PASSWORD_FILE_PERMISSIONS });

        return { success: true, message: 'Password configured successfully' };
    }

    /**
     * Verifies if a password is correct
     *
     * @param {string} password - Password to verify
     * @returns {Promise<boolean>}
     */
    async verifyPassword(password) {
        try {
            if (!await this.hasPassword()) {
                return false;
            }

            const data = await fs.readFile(this.passwordFilePath, 'utf8');
            const { hash: storedHash, salt: storedSalt } = JSON.parse(data);

            const { hash } = await hashPassword(password, Buffer.from(storedSalt, 'hex'));

            return hash === storedHash;
        } catch (error) {
            return false;
        }
    }

    /**
     * Changes the existing password
     *
     * @param {string} oldPassword - Current password
     * @param {string} newPassword - New password
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async changePassword(oldPassword, newPassword) {
        if (!await this.verifyPassword(oldPassword)) {
            return { success: false, message: 'Current password is incorrect' };
        }

        const { hash, salt } = await hashPassword(newPassword);
        const data = JSON.stringify({ hash, salt }, null, 2);

        await fs.writeFile(this.passwordFilePath, data, { mode: PASSWORD_FILE_PERMISSIONS });

        return { success: true, message: 'Password changed successfully' };
    }

    /**
     * Initializes the default password if none exists
     *
     * @returns {Promise<{initialized: boolean, isDefault: boolean}>}
     */
    async initializeDefaultPassword() {
        if (!await this.hasPassword()) {
            await this.setPassword(DEFAULT_PASSWORD);
            return { initialized: true, isDefault: true };
        }

        return { initialized: false, isDefault: false };
    }

    /**
     * Resets password to default (development/testing only)
     *
     * @returns {Promise<{success: boolean}>}
     */
    async resetToDefault() {
        try {
            await fs.unlink(this.passwordFilePath);
        } catch {
            // Ignore if file doesn't exist
        }

        await this.setPassword(DEFAULT_PASSWORD);
        return { success: true };
    }
}

module.exports = {
    PasswordManager,
    DEFAULT_PASSWORD
};
