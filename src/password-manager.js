/**
 * 🔑 Password Manager - Gestión de Contraseña del Maestro
 * 
 * Módulo responsable de almacenar y verificar la contraseña del maestro
 * de forma segura usando hashing PBKDF2.
 * 
 * @module password-manager
 * @author Antonio Sánchez León
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

// === CONSTANTES DE CONFIGURACIÓN ===
const PBKDF2_ITERATIONS = 100000;
const HASH_LENGTH = 64; // 512 bits
const SALT_LENGTH = 32; // 256 bits
const PBKDF2_DIGEST = 'sha512';

// Contraseña predeterminada
const DEFAULT_PASSWORD = 'eduportfolio';

/**
 * Genera un hash seguro de una contraseña usando PBKDF2
 * 
 * @param {string} password - Contraseña a hashear
 * @param {Buffer} [salt] - Salt opcional (se genera si no se proporciona)
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
                if (err) reject(err);
                else {
                    resolve({
                        hash: derivedKey.toString('hex'),
                        salt: passwordSalt.toString('hex')
                    });
                }
            }
        );
    });
}

/**
 * Clase para gestionar la contraseña del maestro
 */
class PasswordManager {
    /**
     * @param {string} dataDir - Directorio donde se almacena el archivo de contraseña
     */
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.passwordFilePath = path.join(dataDir, '.password');
    }

    /**
     * Verifica si existe una contraseña configurada
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
     * Configura la contraseña inicial (solo si no existe)
     * 
     * @param {string} password - Nueva contraseña
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async setPassword(password) {
        const exists = await this.hasPassword();
        if (exists) {
            return { success: false, message: 'Ya existe una contraseña configurada' };
        }

        const { hash, salt } = await hashPassword(password);
        const data = JSON.stringify({ hash, salt }, null, 2);

        await fs.writeFile(this.passwordFilePath, data, { mode: 0o600 }); // Solo lectura/escritura para el propietario

        return { success: true, message: 'Contraseña configurada correctamente' };
    }

    /**
     * Verifica si una contraseña es correcta
     * 
     * @param {string} password - Contraseña a verificar
     * @returns {Promise<boolean>}
     */
    async verifyPassword(password) {
        try {
            const exists = await this.hasPassword();
            if (!exists) {
                return false;
            }

            const data = await fs.readFile(this.passwordFilePath, 'utf8');
            const { hash: storedHash, salt: storedSalt } = JSON.parse(data);

            const { hash } = await hashPassword(password, Buffer.from(storedSalt, 'hex'));

            return hash === storedHash;
        } catch (error) {
            console.error('Error verificando contraseña:', error);
            return false;
        }
    }

    /**
     * Cambia la contraseña existente
     * 
     * @param {string} oldPassword - Contraseña actual
     * @param {string} newPassword - Nueva contraseña
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async changePassword(oldPassword, newPassword) {
        const isValid = await this.verifyPassword(oldPassword);
        if (!isValid) {
            return { success: false, message: 'Contraseña actual incorrecta' };
        }

        const { hash, salt } = await hashPassword(newPassword);
        const data = JSON.stringify({ hash, salt }, null, 2);

        await fs.writeFile(this.passwordFilePath, data, { mode: 0o600 });

        return { success: true, message: 'Contraseña cambiada correctamente' };
    }

    /**
     * Inicializa la contraseña predeterminada si no existe
     * 
     * @returns {Promise<{initialized: boolean, isDefault: boolean}>}
     */
    async initializeDefaultPassword() {
        const exists = await this.hasPassword();

        if (!exists) {
            await this.setPassword(DEFAULT_PASSWORD);
            return { initialized: true, isDefault: true };
        }

        return { initialized: false, isDefault: false };
    }

    /**
     * Resetea la contraseña a la predeterminada (solo para desarrollo/testing)
     * 
     * @returns {Promise<{success: boolean}>}
     */
    async resetToDefault() {
        try {
            await fs.unlink(this.passwordFilePath);
        } catch {
            // Ignorar si no existe
        }

        await this.setPassword(DEFAULT_PASSWORD);
        return { success: true };
    }
}

module.exports = {
    PasswordManager,
    DEFAULT_PASSWORD
};
