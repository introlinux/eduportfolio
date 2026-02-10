/**
 * 🔐 Crypto Manager - Sistema de Encriptación AES-256-GCM
 * 
 * Módulo responsable de la encriptación y desencriptación de archivos
 * usando AES-256-GCM con derivación de clave PBKDF2.
 * 
 * @module crypto-manager
 * @author Antonio Sánchez León
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

// === CONSTANTES DE CONFIGURACIÓN ===
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32; // 256 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const PBKDF2_ITERATIONS = 100000; // Recomendado por OWASP
const PBKDF2_DIGEST = 'sha512';

// Extensión para archivos encriptados
const ENCRYPTED_EXTENSION = '.enc';

/**
 * Deriva una clave criptográfica desde una contraseña usando PBKDF2
 * 
 * @param {string} password - Contraseña del usuario
 * @param {Buffer} salt - Salt aleatorio (debe ser único por archivo)
 * @returns {Promise<Buffer>} Clave derivada de 256 bits
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
                if (err) reject(err);
                else resolve(derivedKey);
            }
        );
    });
}

/**
 * Encripta un buffer de datos usando AES-256-GCM
 * 
 * @param {Buffer} buffer - Datos a encriptar
 * @param {string} password - Contraseña para derivar la clave
 * @returns {Promise<Buffer>} Buffer encriptado con formato: [salt][iv][authTag][datos]
 */
async function encryptBuffer(buffer, password) {
    // Generar salt e IV aleatorios
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);

    // Derivar clave desde contraseña
    const key = await deriveKey(password, salt);

    // Crear cipher y encriptar
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
        cipher.update(buffer),
        cipher.final()
    ]);

    // Obtener authentication tag (GCM)
    const authTag = cipher.getAuthTag();

    // Formato: [salt(32)][iv(16)][authTag(16)][datos encriptados]
    return Buffer.concat([salt, iv, authTag, encrypted]);
}

/**
 * Desencripta un buffer de datos encriptado con AES-256-GCM
 * 
 * @param {Buffer} encryptedBuffer - Buffer encriptado con formato: [salt][iv][authTag][datos]
 * @param {string} password - Contraseña para derivar la clave
 * @returns {Promise<Buffer>} Buffer desencriptado
 * @throws {Error} Si la contraseña es incorrecta o los datos están corruptos
 */
async function decryptBuffer(encryptedBuffer, password) {
    // Extraer componentes del buffer encriptado
    const salt = encryptedBuffer.slice(0, SALT_LENGTH);
    const iv = encryptedBuffer.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = encryptedBuffer.slice(
        SALT_LENGTH + IV_LENGTH,
        SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
    );
    const encrypted = encryptedBuffer.slice(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

    // Derivar clave desde contraseña
    const key = await deriveKey(password, salt);

    // Crear decipher y desencriptar
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    try {
        const decrypted = Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]);
        return decrypted;
    } catch (error) {
        throw new Error('Contraseña incorrecta o datos corruptos');
    }
}

/**
 * Encripta un archivo en disco
 * 
 * @param {string} filePath - Ruta absoluta del archivo a encriptar
 * @param {string} password - Contraseña para encriptar
 * @returns {Promise<{success: boolean, encryptedPath: string}>}
 */
async function encryptFile(filePath, password) {
    try {
        // Leer archivo original
        const fileBuffer = await fs.readFile(filePath);

        // Encriptar contenido
        const encryptedBuffer = await encryptBuffer(fileBuffer, password);

        // Guardar archivo encriptado con extensión .enc
        const encryptedPath = filePath + ENCRYPTED_EXTENSION;
        await fs.writeFile(encryptedPath, encryptedBuffer);

        // Eliminar archivo original (solo queda el encriptado)
        await fs.unlink(filePath);

        return { success: true, encryptedPath };
    } catch (error) {
        throw new Error(`Error encriptando archivo ${filePath}: ${error.message}`);
    }
}

/**
 * Desencripta un archivo en disco
 * 
 * @param {string} encryptedFilePath - Ruta absoluta del archivo encriptado (.enc)
 * @param {string} password - Contraseña para desencriptar
 * @returns {Promise<{success: boolean, decryptedPath: string}>}
 */
async function decryptFile(encryptedFilePath, password) {
    try {
        // Leer archivo encriptado
        const encryptedBuffer = await fs.readFile(encryptedFilePath);

        // Desencriptar contenido
        const decryptedBuffer = await decryptBuffer(encryptedBuffer, password);

        // Guardar archivo desencriptado (quitar extensión .enc)
        const decryptedPath = encryptedFilePath.replace(ENCRYPTED_EXTENSION, '');
        await fs.writeFile(decryptedPath, decryptedBuffer);

        // Eliminar archivo encriptado (solo queda el desencriptado)
        await fs.unlink(encryptedFilePath);

        return { success: true, decryptedPath };
    } catch (error) {
        throw new Error(`Error desencriptando archivo ${encryptedFilePath}: ${error.message}`);
    }
}

/**
 * Verifica si un archivo está encriptado (tiene extensión .enc)
 * 
 * @param {string} filePath - Ruta del archivo
 * @returns {boolean}
 */
function isEncrypted(filePath) {
    return path.extname(filePath) === ENCRYPTED_EXTENSION;
}

/**
 * Obtiene la ruta del archivo encriptado correspondiente
 * 
 * @param {string} filePath - Ruta del archivo original
 * @returns {string} Ruta con extensión .enc
 */
function getEncryptedPath(filePath) {
    return filePath + ENCRYPTED_EXTENSION;
}

/**
 * Obtiene la ruta del archivo desencriptado correspondiente
 * 
 * @param {string} encryptedFilePath - Ruta del archivo encriptado
 * @returns {string} Ruta sin extensión .enc
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
