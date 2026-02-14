# 🧪 Guía de Testing de Sincronización

**Versión:** 3.2.2 - Testing & Debugging
**Fecha:** 2026-02-11

---

## 📋 Pasos para Probar la Sincronización

### 1. ⚙️ Preparar el Escritorio

```bash
# En la terminal del proyecto escritorio
cd D:\eduportfolio
npm start
```

1. Abrir la aplicación de escritorio
2. Iniciar sesión con la contraseña (por defecto: `eduportfolio`)
3. Verificar que estés autenticado (importante)
4. Anotar la IP que aparece en el panel del docente (ej: `192.168.1.100:3000`)

### 2. 📱 Preparar el Móvil

**IMPORTANTE:** Recompilar la app después de los cambios en el código

```bash
# En la terminal del proyecto móvil
cd D:\eduportfolio-mobile

# Limpiar build anterior
flutter clean

# Obtener dependencias
flutter pub get

# Compilar e instalar en el dispositivo
flutter run

# O si prefieres generar APK
flutter build apk
```

### 3. 🔄 Configurar Sincronización en Móvil

1. Abrir la app móvil
2. Ir a Configuración de Sincronización
3. Ingresar la IP del escritorio (ej: `192.168.1.100:3000`)
4. Ingresar la contraseña del escritorio (por defecto: `eduportfolio`)
5. Clic en "Validar contraseña" ✅
6. Si es correcta, clic en "Guardar configuración"

### 4. 🧪 Probar Sincronización

#### Test A: Sincronizar Estudiantes
```
ESCRITORIO:
1. Crear 2 estudiantes nuevos
   - "Estudiante Test 1"
   - "Estudiante Test 2"

MÓVIL:
1. Ir a Sincronización
2. Clic en "Sincronizar"
3. Esperar a que complete
4. Ir a pantalla de captura
5. Verificar que aparecen los 2 estudiantes nuevos ✅
```

#### Test B: Sincronizar Imágenes
```
ESCRITORIO:
1. Capturar 2-3 fotos de un estudiante
2. Verificar que aparecen encriptadas (.enc) en:
   D:\eduportfolio\portfolios\evidences\

MÓVIL:
1. Sincronizar
2. Ir a Galería
3. Las imágenes deben aparecer (no icono roto) ✅
4. Abrir una imagen para verificar
```

---

## 🐛 Debugging

### Ver Logs del Móvil

#### Android (usando ADB)
```bash
# Ver todos los logs
adb logcat | grep -i eduportfolio

# Ver solo errores
adb logcat *:E | grep -i eduportfolio

# Ver logs de sincronización
adb logcat | grep -i "sync\|download\|upload"
```

#### iOS (usando Xcode)
```bash
# Abrir en Xcode y ver consola
flutter run --verbose
```

#### Flutter DevTools
```bash
# Ejecutar app en modo debug
flutter run

# En otra terminal
flutter pub global activate devtools
flutter pub global run devtools

# Abrir DevTools en el navegador y ver logs
```

### Verificar Archivos Descargados

#### Android
```bash
# Conectar dispositivo
adb shell

# Navegar a directorio de la app
cd /data/data/com.example.eduportfolio/app_flutter/

# Listar evidencias
ls -la evidences/

# Salir
exit
```

#### iOS
```bash
# Usar Xcode > Window > Devices and Simulators
# Seleccionar el dispositivo > Installed Apps > Eduportfolio
# Download Container > Ver archivos
```

---

## ❌ Problemas Comunes

### Problema 1: Imágenes con Icono Roto

**Posibles Causas:**
1. ❌ Archivos no se descargaron (error de autenticación)
2. ❌ Archivos se descargaron pero con extensión `.enc`
3. ❌ Archivos se descargaron pero no existen en la ruta esperada

**Solución:**
```bash
# Ver logs del móvil durante sincronización
adb logcat | grep -i "download\|error"

# Buscar mensajes como:
# "Downloaded and saved decrypted file: foto.jpg" ✅
# "Failed to download file: ..." ❌
```

### Problema 2: Estudiantes No Aparecen

**Posibles Causas:**
1. ❌ No se compiló la app después de los cambios
2. ❌ Estudiantes están marcados como inactivos (`isActive = 0`)
3. ❌ Error en la sincronización que se silenció

**Solución:**
```bash
# Verificar que el servidor devuelve estudiantes
curl -H "Authorization: Bearer eduportfolio" \
  http://192.168.1.100:3000/api/sync/metadata

# Debe devolver JSON con array "students"
```

### Problema 3: Error de Autenticación

**Síntomas:**
- Sincronización falla inmediatamente
- Mensaje de "Contraseña incorrecta"

**Solución:**
1. Verificar que iniciaste sesión en el escritorio
2. Verificar que la contraseña es correcta
3. Probar validar contraseña de nuevo en el móvil

### Problema 4: No se Conecta al Servidor

**Síntomas:**
- "Cannot connect to server"
- Timeout

**Solución:**
1. Verificar que ambos dispositivos están en la misma red Wi-Fi
2. Verificar que el firewall no bloquea puerto 3000
3. Ping al servidor desde el móvil:
```bash
# En Android
adb shell
ping 192.168.1.100
```

---

## 📊 Verificar Estado de Sincronización

### En el Escritorio

1. Panel del Docente (tecla P)
2. Sección "Estadísticas del Sistema"
3. Ver:
   - Número de evidencias
   - Número de estudiantes
   - Estadísticas de cache

### En el Móvil

1. Ir a Galería
2. Aplicar filtros
3. Verificar que aparecen las evidencias sincronizadas

---

## 🔍 Checklist de Debugging

Usa este checklist si algo no funciona:

```
Escritorio:
☐ Servidor iniciado (npm start)
☐ Sesión iniciada con contraseña
☐ IP visible en Panel del Docente
☐ Estudiantes creados y visibles en galería

Móvil:
☐ App recompilada después de cambios (flutter clean + flutter run)
☐ Contraseña configurada y validada ✅
☐ Mismo Wi-Fi que el escritorio
☐ Sincronización ejecutada sin errores

Archivos:
☐ Archivos .enc en escritorio (D:\eduportfolio\portfolios\evidences\)
☐ Archivos .jpg en móvil (sin .enc)
☐ Registros en BD del móvil

Logs:
☐ No hay errores de autenticación
☐ No hay errores de descarga
☐ Mensajes "Downloaded and saved decrypted file" aparecen
```

---

## 💡 Tips

1. **Siempre recompilar** después de cambios en código Dart
2. **Limpiar caché** si algo no funciona: `flutter clean`
3. **Ver logs** durante sincronización para detectar errores
4. **Probar con pocas imágenes** primero (2-3) antes de sincronizar todo
5. **Verificar autenticación** en el escritorio antes de sincronizar

---

## 📞 Si Nada Funciona

1. Desinstalar app móvil completamente
2. Recompilar e instalar de cero
3. Configurar sincronización de nuevo
4. Probar con 1 solo estudiante y 1 sola foto

---

**Última actualización:** 2026-02-11
**Estado:** Lista para probar
