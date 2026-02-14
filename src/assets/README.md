# Iconos de la aplicación

Esta carpeta debe contener los iconos para el empaquetado de Electron.

## Iconos necesarios

### Windows
- **icon.ico**: Icono para Windows (256x256 o superior)
  - Debe ser un archivo .ico con múltiples resoluciones embebidas
  - Tamaños recomendados: 16x16, 32x32, 48x48, 64x64, 128x128, 256x256

### Linux
- **icon.png**: Icono para Linux (512x512 recomendado)
  - Formato PNG con transparencia
  - Tamaño: mínimo 256x256, recomendado 512x512 o superior

## Crear los iconos

### Opción 1: Diseño manual
1. Crea un diseño cuadrado en tu editor favorito (Figma, Photoshop, GIMP, etc.)
2. Exporta como PNG de 512x512 píxeles
3. Convierte a ICO usando herramientas online o software como ImageMagick

### Opción 2: Conversión automática
Si tienes un PNG de alta resolución:

```bash
# Instalar electron-icon-builder globalmente
npm install -g electron-icon-builder

# Generar iconos desde un PNG
electron-icon-builder --input=./icon-source.png --output=./src/assets
```

### Opción 3: Herramientas online
- https://www.icoconverter.com/ - Convertir PNG a ICO
- https://iconverticons.com/online/ - Múltiples formatos
- https://cloudconvert.com/ - Conversor universal

## Nota
Si no se proporcionan iconos, electron-builder usará un icono genérico por defecto.
