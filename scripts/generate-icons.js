const pngToIco = require('png-to-ico').default;
const fs = require('fs');
const path = require('path');

async function generateIcons() {
    const inputPng = path.join(__dirname, '..', 'src', 'assets', 'icon.png');
    const outputIco = path.join(__dirname, '..', 'src', 'assets', 'icon.ico');

    console.log('Generando icon.ico desde icon.png...');
    console.log('Entrada:', inputPng);
    console.log('Salida:', outputIco);

    try {
        // Verificar que el PNG existe
        if (!fs.existsSync(inputPng)) {
            throw new Error(`No se encontró el archivo ${inputPng}`);
        }

        // Generar .ico con múltiples resoluciones
        const buffer = await pngToIco(inputPng);
        fs.writeFileSync(outputIco, buffer);

        console.log('✓ icon.ico generado exitosamente en src/assets/');
        console.log('  Contiene múltiples resoluciones para Windows');
    } catch (error) {
        console.error('✗ Error al generar icon.ico:', error.message);
        process.exit(1);
    }
}

generateIcons();
