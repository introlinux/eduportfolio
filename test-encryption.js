/**
 * 🧪 Test del Sistema de Encriptación
 * 
 * Script para verificar la funcionalidad del sistema de encriptación de portfolios
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('./src/crypto-manager');
const { PasswordManager } = require('./src/password-manager');
const { PortfolioVault } = require('./src/portfolio-vault');

// Configuración de rutas de prueba
const TEST_DIR = path.join(__dirname, 'test_encryption');
const TEST_DATA_DIR = path.join(TEST_DIR, 'data');
const TEST_PORTFOLIOS_DIR = path.join(TEST_DIR, 'portfolios');

// Colores para consola
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Crea archivos de prueba
 */
async function setupTestFiles() {
    log('\n📁 Creando archivos de prueba...', 'blue');

    // Crear directorios
    await fs.mkdir(TEST_DATA_DIR, { recursive: true });
    await fs.mkdir(path.join(TEST_PORTFOLIOS_DIR, 'Juan_Perez_1/Matematicas'), { recursive: true });
    await fs.mkdir(path.join(TEST_PORTFOLIOS_DIR, 'Maria_Lopez_2/Lengua'), { recursive: true });

    // Crear archivos de prueba (simulando imágenes)
    const testContent1 = 'Este es un archivo de prueba 1 - Matemáticas de Juan';
    const testContent2 = 'Este es un archivo de prueba 2 - Lengua de María';

    await fs.writeFile(
        path.join(TEST_PORTFOLIOS_DIR, 'Juan_Perez_1/Matematicas/test1.jpg'),
        testContent1
    );
    await fs.writeFile(
        path.join(TEST_PORTFOLIOS_DIR, 'Maria_Lopez_2/Lengua/test2.jpg'),
        testContent2
    );

    log('✅ Archivos de prueba creados', 'green');
}

/**
 * Test 1: Encriptación y desencriptación de buffer
 */
async function testBufferEncryption() {
    log('\n🧪 Test 1: Encriptación/Desencriptación de Buffer', 'blue');

    const originalData = 'Datos secretos de prueba 🔐';
    const password = 'test123';

    try {
        // Encriptar
        const encrypted = await crypto.encryptBuffer(Buffer.from(originalData), password);
        log(`  ✓ Buffer encriptado (${encrypted.length} bytes)`, 'green');

        // Verificar que está encriptado (no contiene el texto original)
        if (!encrypted.toString().includes(originalData)) {
            log('  ✓ Datos correctamente encriptados (no legibles)', 'green');
        } else {
            throw new Error('Los datos encriptados contienen el texto original');
        }

        // Desencriptar
        const decrypted = await crypto.decryptBuffer(encrypted, password);
        const decryptedText = decrypted.toString();

        if (decryptedText === originalData) {
            log('  ✓ Datos correctamente desencriptados', 'green');
            log('✅ Test 1 PASADO', 'green');
            return true;
        } else {
            throw new Error('Los datos desencriptados no coinciden');
        }
    } catch (error) {
        log(`  ✗ Error: ${error.message}`, 'red');
        log('❌ Test 1 FALLIDO', 'red');
        return false;
    }
}

/**
 * Test 2: Contraseña incorrecta debe fallar
 */
async function testWrongPassword() {
    log('\n🧪 Test 2: Contraseña Incorrecta', 'blue');

    const originalData = 'Datos secretos';
    const correctPassword = 'correct123';
    const wrongPassword = 'wrong456';

    try {
        const encrypted = await crypto.encryptBuffer(Buffer.from(originalData), correctPassword);

        try {
            await crypto.decryptBuffer(encrypted, wrongPassword);
            log('  ✗ Desencriptación con contraseña incorrecta debería fallar', 'red');
            log('❌ Test 2 FALLIDO', 'red');
            return false;
        } catch (error) {
            if (error.message.includes('Contraseña incorrecta')) {
                log('  ✓ Contraseña incorrecta rechazada correctamente', 'green');
                log('✅ Test 2 PASADO', 'green');
                return true;
            } else {
                throw error;
            }
        }
    } catch (error) {
        log(`  ✗ Error inesperado: ${error.message}`, 'red');
        log('❌ Test 2 FALLIDO', 'red');
        return false;
    }
}

/**
 * Test 3: Gestión de contraseña
 */
async function testPasswordManager() {
    log('\n🧪 Test 3: Gestión de Contraseña', 'blue');

    const passwordManager = new PasswordManager(TEST_DATA_DIR);
    const testPassword = 'mySecurePassword123';

    try {
        // Configurar contraseña
        const setResult = await passwordManager.setPassword(testPassword);
        if (setResult.success) {
            log('  ✓ Contraseña configurada correctamente', 'green');
        } else {
            throw new Error('No se pudo configurar la contraseña');
        }

        // Verificar contraseña correcta
        const isValid = await passwordManager.verifyPassword(testPassword);
        if (isValid) {
            log('  ✓ Contraseña correcta verificada', 'green');
        } else {
            throw new Error('Verificación de contraseña correcta falló');
        }

        // Verificar contraseña incorrecta
        const isInvalid = await passwordManager.verifyPassword('wrongPassword');
        if (!isInvalid) {
            log('  ✓ Contraseña incorrecta rechazada', 'green');
        } else {
            throw new Error('Contraseña incorrecta fue aceptada');
        }

        // Cambiar contraseña
        const newPassword = 'newPassword456';
        const changeResult = await passwordManager.changePassword(testPassword, newPassword);
        if (changeResult.success) {
            log('  ✓ Contraseña cambiada correctamente', 'green');
        } else {
            throw new Error('No se pudo cambiar la contraseña');
        }

        // Verificar nueva contraseña
        const isNewValid = await passwordManager.verifyPassword(newPassword);
        if (isNewValid) {
            log('  ✓ Nueva contraseña verificada', 'green');
        } else {
            throw new Error('Nueva contraseña no funciona');
        }

        log('✅ Test 3 PASADO', 'green');
        return true;
    } catch (error) {
        log(`  ✗ Error: ${error.message}`, 'red');
        log('❌ Test 3 FALLIDO', 'red');
        return false;
    }
}

/**
 * Test 4: Encriptación de archivos
 */
async function testFileEncryption() {
    log('\n🧪 Test 4: Encriptación de Archivos', 'blue');

    const testFile = path.join(TEST_PORTFOLIOS_DIR, 'Juan_Perez_1/Matematicas/test1.jpg');
    const password = 'fileTest123';

    try {
        // Leer contenido original
        const originalContent = await fs.readFile(testFile, 'utf8');
        log(`  ✓ Archivo original leído: "${originalContent.substring(0, 30)}..."`, 'green');

        // Encriptar archivo
        const encryptResult = await crypto.encryptFile(testFile, password);
        log(`  ✓ Archivo encriptado: ${path.basename(encryptResult.encryptedPath)}`, 'green');

        // Verificar que el archivo original ya no existe
        try {
            await fs.access(testFile);
            throw new Error('El archivo original todavía existe');
        } catch {
            log('  ✓ Archivo original eliminado correctamente', 'green');
        }

        // Verificar que el archivo encriptado existe
        const encryptedContent = await fs.readFile(encryptResult.encryptedPath);
        if (!encryptedContent.toString().includes(originalContent)) {
            log('  ✓ Contenido encriptado (no legible)', 'green');
        } else {
            throw new Error('El archivo encriptado contiene texto legible');
        }

        // Desencriptar archivo
        const decryptResult = await crypto.decryptFile(encryptResult.encryptedPath, password);
        log(`  ✓ Archivo desencriptado: ${path.basename(decryptResult.decryptedPath)}`, 'green');

        // Verificar contenido desencriptado
        const decryptedContent = await fs.readFile(decryptResult.decryptedPath, 'utf8');
        if (decryptedContent === originalContent) {
            log('  ✓ Contenido restaurado correctamente', 'green');
        } else {
            throw new Error('El contenido desencriptado no coincide');
        }

        log('✅ Test 4 PASADO', 'green');
        return true;
    } catch (error) {
        log(`  ✗ Error: ${error.message}`, 'red');
        log('❌ Test 4 FALLIDO', 'red');
        return false;
    }
}

/**
 * Test 5: Portfolio Vault (bloquear/desbloquear baúl completo)
 */
async function testPortfolioVault() {
    log('\n🧪 Test 5: Portfolio Vault (Baúl Completo)', 'blue');

    const vault = new PortfolioVault(TEST_PORTFOLIOS_DIR, TEST_DATA_DIR);
    const password = 'vaultTest123';

    try {
        // Obtener estadísticas iniciales
        const initialStats = await vault.getStats();
        log(`  ℹ️  Archivos iniciales: ${initialStats.totalFiles}`, 'yellow');

        // Bloquear baúl
        log('  🔒 Bloqueando baúl...', 'yellow');
        const lockResult = await vault.lockVault(password);
        if (lockResult.success) {
            log(`  ✓ Baúl bloqueado: ${lockResult.filesEncrypted} archivos encriptados`, 'green');
        } else {
            throw new Error('No se pudo bloquear el baúl');
        }

        // Verificar estado bloqueado
        const isLocked = await vault.isLocked();
        if (isLocked) {
            log('  ✓ Estado del baúl: BLOQUEADO', 'green');
        } else {
            throw new Error('El baúl no está marcado como bloqueado');
        }

        // Verificar que los archivos están encriptados
        const lockedStats = await vault.getStats();
        if (lockedStats.encryptedFiles > 0) {
            log(`  ✓ Archivos encriptados: ${lockedStats.encryptedFiles}`, 'green');
        } else {
            throw new Error('No hay archivos encriptados');
        }

        // Desbloquear baúl
        log('  🔓 Desbloqueando baúl...', 'yellow');
        const unlockResult = await vault.unlockVault(password);
        if (unlockResult.success) {
            log(`  ✓ Baúl desbloqueado: ${unlockResult.filesDecrypted} archivos desencriptados`, 'green');
        } else {
            throw new Error('No se pudo desbloquear el baúl');
        }

        // Verificar estado desbloqueado
        const isUnlocked = !(await vault.isLocked());
        if (isUnlocked) {
            log('  ✓ Estado del baúl: DESBLOQUEADO', 'green');
        } else {
            throw new Error('El baúl no está marcado como desbloqueado');
        }

        log('✅ Test 5 PASADO', 'green');
        return true;
    } catch (error) {
        log(`  ✗ Error: ${error.message}`, 'red');
        log('❌ Test 5 FALLIDO', 'red');
        return false;
    }
}

/**
 * Limpieza de archivos de prueba
 */
async function cleanup() {
    log('\n🧹 Limpiando archivos de prueba...', 'blue');
    try {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
        log('✅ Archivos de prueba eliminados', 'green');
    } catch (error) {
        log(`⚠️  Error en limpieza: ${error.message}`, 'yellow');
    }
}

/**
 * Ejecutar todos los tests
 */
async function runAllTests() {
    log('═══════════════════════════════════════════════', 'blue');
    log('🧪 SUITE DE TESTS - SISTEMA DE ENCRIPTACIÓN', 'blue');
    log('═══════════════════════════════════════════════', 'blue');

    const results = [];

    try {
        // Setup
        await setupTestFiles();

        // Ejecutar tests
        results.push(await testBufferEncryption());
        results.push(await testWrongPassword());
        results.push(await testPasswordManager());
        results.push(await testFileEncryption());
        results.push(await testPortfolioVault());

    } catch (error) {
        log(`\n❌ Error fatal: ${error.message}`, 'red');
        console.error(error);
    } finally {
        // Cleanup
        await cleanup();
    }

    // Resumen
    const passed = results.filter(r => r === true).length;
    const total = results.length;

    log('\n═══════════════════════════════════════════════', 'blue');
    log(`📊 RESUMEN: ${passed}/${total} tests pasados`, passed === total ? 'green' : 'yellow');
    log('═══════════════════════════════════════════════', 'blue');

    if (passed === total) {
        log('\n🎉 ¡TODOS LOS TESTS PASARON!', 'green');
        process.exit(0);
    } else {
        log(`\n⚠️  ${total - passed} test(s) fallaron`, 'red');
        process.exit(1);
    }
}

// Ejecutar tests
runAllTests();
