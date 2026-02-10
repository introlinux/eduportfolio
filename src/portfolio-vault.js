/**
 * 🗄️ Portfolio Vault - Gestión del Baúl de Portfolios Encriptados
 * 
 * Módulo responsable de encriptar/desencriptar la carpeta completa de portfolios
 * y gestionar el estado del "baúl" (locked/unlocked).
 * 
 * @module portfolio-vault
 * @author Antonio Sánchez León
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('./crypto-manager');

/**
 * Clase para gestionar el baúl de portfolios encriptados
 */
class PortfolioVault {
    /**
     * @param {string} portfoliosDir - Directorio de portfolios
     * @param {string} dataDir - Directorio de datos (para archivo de estado)
     */
    constructor(portfoliosDir, dataDir) {
        this.portfoliosDir = portfoliosDir;
        this.dataDir = dataDir;
        this.vaultStatePath = path.join(dataDir, '.vault_state');
    }

    /**
     * Verifica si el baúl está bloqueado (archivos encriptados)
     * 
     * @returns {Promise<boolean>}
     */
    async isLocked() {
        try {
            const state = await fs.readFile(this.vaultStatePath, 'utf8');
            const { locked } = JSON.parse(state);
            return locked === true;
        } catch {
            // Si no existe el archivo de estado, asumimos que está desbloqueado
            return false;
        }
    }

    /**
     * Establece el estado del baúl
     * 
     * @param {boolean} locked - true si está bloqueado, false si está desbloqueado
     * @returns {Promise<void>}
     */
    async setLockState(locked) {
        const state = JSON.stringify({ locked, timestamp: new Date().toISOString() }, null, 2);
        await fs.writeFile(this.vaultStatePath, state);
    }

    /**
     * Obtiene todos los archivos de imagen en la carpeta de portfolios
     * 
     * @param {string} dir - Directorio a escanear
     * @param {string[]} fileList - Lista acumulativa de archivos
     * @returns {Promise<string[]>} Lista de rutas absolutas de archivos
     */
    async getAllImageFiles(dir = this.portfoliosDir, fileList = []) {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                // Ignorar carpeta temporal
                if (entry.name === '_temporal_') continue;

                // Recursión en subdirectorios
                await this.getAllImageFiles(fullPath, fileList);
            } else if (entry.isFile()) {
                // Solo procesar archivos de imagen (.jpg, .png, .jpeg)
                const ext = path.extname(entry.name).toLowerCase();
                if (['.jpg', '.jpeg', '.png'].includes(ext) || ext === crypto.ENCRYPTED_EXTENSION) {
                    fileList.push(fullPath);
                }
            }
        }

        return fileList;
    }

    /**
     * Bloquea el baúl encriptando todos los archivos de portfolios
     * 
     * @param {string} password - Contraseña para encriptar
     * @returns {Promise<{success: boolean, filesEncrypted: number, errors: string[]}>}
     */
    async lockVault(password) {
        const locked = await this.isLocked();
        if (locked) {
            return { success: false, filesEncrypted: 0, errors: ['El baúl ya está bloqueado'] };
        }

        console.log('🔒 Bloqueando baúl de portfolios...');

        const files = await this.getAllImageFiles();
        const errors = [];
        let filesEncrypted = 0;

        for (const filePath of files) {
            // Saltar archivos ya encriptados
            if (crypto.isEncrypted(filePath)) continue;

            try {
                await crypto.encryptFile(filePath, password);
                filesEncrypted++;
                console.log(`  ✓ Encriptado: ${path.basename(filePath)}`);
            } catch (error) {
                errors.push(`Error encriptando ${filePath}: ${error.message}`);
                console.error(`  ✗ Error: ${path.basename(filePath)}`);
            }
        }

        await this.setLockState(true);
        console.log(`🔒 Baúl bloqueado. ${filesEncrypted} archivos encriptados.`);

        return { success: true, filesEncrypted, errors };
    }

    /**
     * Desbloquea el baúl desencriptando todos los archivos de portfolios
     * 
     * @param {string} password - Contraseña para desencriptar
     * @returns {Promise<{success: boolean, filesDecrypted: number, errors: string[]}>}
     */
    async unlockVault(password) {
        console.log('🔓 Desbloqueando baúl de portfolios...');

        const files = await this.getAllImageFiles();
        const errors = [];
        let filesDecrypted = 0;

        for (const filePath of files) {
            // Solo procesar archivos encriptados
            if (!crypto.isEncrypted(filePath)) continue;

            try {
                await crypto.decryptFile(filePath, password);
                filesDecrypted++;
                console.log(`  ✓ Desencriptado: ${path.basename(filePath)}`);
            } catch (error) {
                errors.push(`Error desencriptando ${filePath}: ${error.message}`);
                console.error(`  ✗ Error: ${path.basename(filePath)}`);
            }
        }

        // Solo marcar como desbloqueado si no hubo errores críticos
        if (errors.length === 0) {
            await this.setLockState(false);
            console.log(`🔓 Baúl desbloqueado. ${filesDecrypted} archivos desencriptados.`);
            return { success: true, filesDecrypted, errors };
        } else {
            console.error(`❌ Error desbloqueando baúl. Contraseña incorrecta o archivos corruptos.`);
            return { success: false, filesDecrypted, errors };
        }
    }

    /**
     * Encripta un archivo nuevo que se acaba de guardar
     * (Solo si el baúl está bloqueado)
     * 
     * @param {string} filePath - Ruta del archivo a encriptar
     * @param {string} password - Contraseña para encriptar
     * @returns {Promise<{success: boolean, encrypted: boolean}>}
     */
    async encryptNewFile(filePath, password) {
        const locked = await this.isLocked();

        // Si el baúl está desbloqueado, no encriptar archivos nuevos
        if (!locked) {
            return { success: true, encrypted: false };
        }

        try {
            await crypto.encryptFile(filePath, password);
            return { success: true, encrypted: true };
        } catch (error) {
            console.error(`Error encriptando archivo nuevo: ${error.message}`);
            return { success: false, encrypted: false };
        }
    }

    /**
     * Obtiene estadísticas del baúl
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
