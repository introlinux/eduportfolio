/**
 * 🧠 Decryption Cache - Cache LRU en Memoria para Imágenes Desencriptadas
 *
 * Mantiene imágenes desencriptadas en memoria RAM (nunca en disco) usando
 * una estrategia LRU (Least Recently Used) para limitar el uso de memoria.
 *
 * @module decryption-cache
 * @author Antonio Sánchez León
 */

const crypto = require('./crypto-manager');
const fs = require('fs').promises;
const path = require('path');

/**
 * Nodo de la lista doblemente enlazada para el cache LRU
 */
class CacheNode {
    constructor(key, value) {
        this.key = key;
        this.value = value;
        this.prev = null;
        this.next = null;
    }
}

/**
 * Cache LRU (Least Recently Used) para almacenar imágenes desencriptadas en memoria
 */
class DecryptionCache {
    /**
     * @param {number} maxSize - Número máximo de imágenes a mantener en cache
     * @param {number} maxAge - Tiempo máximo en ms que una entrada puede permanecer en cache (opcional)
     */
    constructor(maxSize = 100, maxAge = 30 * 60 * 1000) { // 30 minutos por defecto
        this.maxSize = maxSize;
        this.maxAge = maxAge;
        this.cache = new Map(); // key -> CacheNode
        this.head = new CacheNode('HEAD', null); // Dummy head (más reciente)
        this.tail = new CacheNode('TAIL', null); // Dummy tail (menos reciente)
        this.head.next = this.tail;
        this.tail.prev = this.head;

        // Estadísticas
        this.hits = 0;
        this.misses = 0;

        console.log(`🧠 Cache de desencriptación inicializado (max: ${maxSize} imágenes, TTL: ${maxAge / 1000}s)`);
    }

    /**
     * Obtiene una imagen desencriptada del cache o la desencripta si no está
     *
     * @param {string} filePath - Ruta absoluta del archivo encriptado
     * @param {string} password - Contraseña para desencriptar
     * @returns {Promise<Buffer>} Buffer de la imagen desencriptada
     */
    async get(filePath, password) {
        const key = this._generateKey(filePath);

        // Verificar si está en cache y es válido
        if (this.cache.has(key)) {
            const node = this.cache.get(key);

            // Verificar si ha expirado
            if (Date.now() - node.value.timestamp > this.maxAge) {
                console.log(`⏰ Cache expirado: ${path.basename(filePath)}`);
                this._remove(node);
                this.cache.delete(key);
            } else {
                // Hit! Mover al frente (más reciente)
                this._moveToFront(node);
                this.hits++;
                console.log(`✅ Cache HIT: ${path.basename(filePath)} (${this.hits}/${this.hits + this.misses} = ${(100 * this.hits / (this.hits + this.misses)).toFixed(1)}%)`);
                return node.value.buffer;
            }
        }

        // Miss! Desencriptar desde disco
        this.misses++;
        console.log(`❌ Cache MISS: ${path.basename(filePath)} - Desencriptando...`);

        const buffer = await this._decryptFromDisk(filePath, password);

        // Guardar en cache
        this._put(key, buffer);

        return buffer;
    }

    /**
     * Desencripta un archivo desde disco directamente a memoria (SIN escribir el archivo desencriptado)
     *
     * @param {string} filePath - Ruta del archivo (puede estar encriptado o no)
     * @param {string} password - Contraseña de desencriptación
     * @returns {Promise<Buffer>} Buffer desencriptado
     * @private
     */
    async _decryptFromDisk(filePath, password) {
        // Verificar si el archivo está encriptado
        const encryptedPath = crypto.isEncrypted(filePath)
            ? filePath
            : crypto.getEncryptedPath(filePath);

        try {
            // Intentar leer archivo encriptado
            const encryptedBuffer = await fs.readFile(encryptedPath);

            // Desencriptar en memoria
            const decryptedBuffer = await crypto.decryptBuffer(encryptedBuffer, password);

            return decryptedBuffer;
        } catch (error) {
            // Si falla, intentar leer el archivo sin encriptar (fallback)
            if (error.code === 'ENOENT') {
                console.log(`⚠️  Archivo encriptado no encontrado, intentando leer sin encriptar: ${path.basename(filePath)}`);
                return await fs.readFile(filePath);
            }
            throw error;
        }
    }

    /**
     * Genera una clave única para el cache
     *
     * @param {string} filePath
     * @returns {string}
     * @private
     */
    _generateKey(filePath) {
        // Normalizar la ruta y quitar extensión .enc si existe
        const normalized = path.normalize(filePath).replace(/\.enc$/i, '');
        return normalized;
    }

    /**
     * Guarda un buffer en el cache
     *
     * @param {string} key
     * @param {Buffer} buffer
     * @private
     */
    _put(key, buffer) {
        // Si ya existe, actualizar
        if (this.cache.has(key)) {
            const node = this.cache.get(key);
            node.value = { buffer, timestamp: Date.now() };
            this._moveToFront(node);
            return;
        }

        // Si el cache está lleno, eliminar el menos reciente
        if (this.cache.size >= this.maxSize) {
            const lru = this.tail.prev;
            this._remove(lru);
            this.cache.delete(lru.key);
            console.log(`🗑️  Cache lleno, eliminado LRU: ${lru.key}`);
        }

        // Crear nuevo nodo
        const newNode = new CacheNode(key, { buffer, timestamp: Date.now() });
        this.cache.set(key, newNode);
        this._addToFront(newNode);
    }

    /**
     * Agrega un nodo al frente de la lista (más reciente)
     *
     * @param {CacheNode} node
     * @private
     */
    _addToFront(node) {
        node.prev = this.head;
        node.next = this.head.next;
        this.head.next.prev = node;
        this.head.next = node;
    }

    /**
     * Remueve un nodo de la lista
     *
     * @param {CacheNode} node
     * @private
     */
    _remove(node) {
        node.prev.next = node.next;
        node.next.prev = node.prev;
    }

    /**
     * Mueve un nodo al frente (marca como más reciente)
     *
     * @param {CacheNode} node
     * @private
     */
    _moveToFront(node) {
        this._remove(node);
        this._addToFront(node);
    }

    /**
     * Limpia todo el cache
     */
    clear() {
        this.cache.clear();
        this.head.next = this.tail;
        this.tail.prev = this.head;
        this.hits = 0;
        this.misses = 0;
        console.log('🧹 Cache limpiado completamente');
    }

    /**
     * Elimina entradas expiradas del cache
     *
     * @returns {number} Número de entradas eliminadas
     */
    cleanExpired() {
        const now = Date.now();
        let removed = 0;

        for (const [key, node] of this.cache.entries()) {
            if (now - node.value.timestamp > this.maxAge) {
                this._remove(node);
                this.cache.delete(key);
                removed++;
            }
        }

        if (removed > 0) {
            console.log(`🧹 Limpiadas ${removed} entradas expiradas del cache`);
        }

        return removed;
    }

    /**
     * Obtiene estadísticas del cache
     *
     * @returns {object}
     */
    getStats() {
        const totalRequests = this.hits + this.misses;
        const hitRate = totalRequests > 0 ? (this.hits / totalRequests * 100) : 0;

        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hits: this.hits,
            misses: this.misses,
            hitRate: hitRate.toFixed(2) + '%',
            totalRequests
        };
    }

    /**
     * Invalida una entrada específica del cache (útil si un archivo se actualiza)
     *
     * @param {string} filePath
     */
    invalidate(filePath) {
        const key = this._generateKey(filePath);
        if (this.cache.has(key)) {
            const node = this.cache.get(key);
            this._remove(node);
            this.cache.delete(key);
            console.log(`🗑️  Invalidado del cache: ${path.basename(filePath)}`);
        }
    }
}

module.exports = { DecryptionCache };
