/**
 * Crypto Manager - AES-256-GCM Encryption System
 *
 * Module responsible for file encryption and decryption
 * using AES-256-GCM with PBKDF2 key derivation.
 *
 * @module crypto-manager
 * @author Antonio Sánchez León
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

// Encryption configuration constants
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32; // 256 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const PBKDF2_ITERATIONS = 100000; // OWASP recommended
const PBKDF2_DIGEST = 'sha512';

const ENCRYPTED_EXTENSION = '.enc';

/**
 * Derives a cryptographic key from a password using PBKDF2
 *
 * @param {string} password - User password
 * @param {Buffer} salt - Random salt (must be unique per file)
 * @returns {Promise<Buffer>} Derived 256-bit key
 */
function deriveKey(password, salt) {
    return new Promise((resolve, reject) => {
        crypto.pbkdf2(
            password,
            salt,
            PBKDF2_ITERATIONS,
            KEY_LENGTH,
            PBKDF2_DIGEST,
            (err, derivedKey) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(derivedKey);
            }
        );
    });
}

/**
 * Encrypts a data buffer using AES-256-GCM
 *
 * @param {Buffer} buffer - Data to encrypt
 * @param {string} password - Password to derive the key
 * @returns {Promise<Buffer>} Encrypted buffer with format: [salt][iv][authTag][data]
 */
async function encryptBuffer(buffer, password) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);

    const key = await deriveKey(password, salt);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
        cipher.update(buffer),
        cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    // Format: [salt(32)][iv(16)][authTag(16)][encrypted data]
    return Buffer.concat([salt, iv, authTag, encrypted]);
}

/**
 * Decrypts an encrypted data buffer using AES-256-GCM
 *
 * @param {Buffer} encryptedBuffer - Encrypted buffer with format: [salt][iv][authTag][data]
 * @param {string} password - Password to derive the key
 * @returns {Promise<Buffer>} Decrypted buffer
 * @throws {Error} If password is incorrect or data is corrupted
 */
async function decryptBuffer(encryptedBuffer, password) {
    const salt = encryptedBuffer.slice(0, SALT_LENGTH);
    const iv = encryptedBuffer.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = encryptedBuffer.slice(
        SALT_LENGTH + IV_LENGTH,
        SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
    );
    const encrypted = encryptedBuffer.slice(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

    const key = await deriveKey(password, salt);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    try {
        return Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]);
    } catch (error) {
        throw new Error('Incorrect password or corrupted data');
    }
}

/**
 * Encrypts a file on disk
 *
 * @param {string} filePath - Absolute path to file to encrypt
 * @param {string} password - Password for encryption
 * @returns {Promise<{success: boolean, encryptedPath: string}>}
 */
async function encryptFile(filePath, password) {
    try {
        const fileBuffer = await fs.readFile(filePath);
        const encryptedBuffer = await encryptBuffer(fileBuffer, password);

        const encryptedPath = filePath + ENCRYPTED_EXTENSION;
        await fs.writeFile(encryptedPath, encryptedBuffer);
        await fs.unlink(filePath);

        return { success: true, encryptedPath };
    } catch (error) {
        throw new Error(`Error encrypting file ${filePath}: ${error.message}`);
    }
}

/**
 * Decrypts a file on disk
 *
 * @param {string} encryptedFilePath - Absolute path to encrypted file (.enc)
 * @param {string} password - Password for decryption
 * @returns {Promise<{success: boolean, decryptedPath: string}>}
 */
async function decryptFile(encryptedFilePath, password) {
    try {
        const encryptedBuffer = await fs.readFile(encryptedFilePath);
        const decryptedBuffer = await decryptBuffer(encryptedBuffer, password);

        const decryptedPath = encryptedFilePath.replace(ENCRYPTED_EXTENSION, '');
        await fs.writeFile(decryptedPath, decryptedBuffer);
        await fs.unlink(encryptedFilePath);

        return { success: true, decryptedPath };
    } catch (error) {
        throw new Error(`Error decrypting file ${encryptedFilePath}: ${error.message}`);
    }
}

/**
 * Checks if a file is encrypted (has .enc extension)
 *
 * @param {string} filePath - File path
 * @returns {boolean} True if file is encrypted
 */
function isEncrypted(filePath) {
    return path.extname(filePath) === ENCRYPTED_EXTENSION;
}

/**
 * Gets the corresponding encrypted file path
 *
 * @param {string} filePath - Original file path
 * @returns {string} Path with .enc extension
 */
function getEncryptedPath(filePath) {
    return filePath + ENCRYPTED_EXTENSION;
}

/**
 * Gets the corresponding decrypted file path
 *
 * @param {string} encryptedFilePath - Encrypted file path
 * @returns {string} Path without .enc extension
 */
function getDecryptedPath(encryptedFilePath) {
    return encryptedFilePath.replace(ENCRYPTED_EXTENSION, '');
}

module.exports = {
    encryptBuffer,
    decryptBuffer,
    encryptFile,
    decryptFile,
    isEncrypted,
    getEncryptedPath,
    getDecryptedPath,
    ENCRYPTED_EXTENSION
};
