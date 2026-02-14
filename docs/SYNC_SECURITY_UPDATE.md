# 🔐 Actualización de Seguridad para Sincronización

**Fecha:** 2026-02-11
**Versión:** 3.2 - Sync Security & Decryption

---

## 📋 Resumen

Se han implementado mejoras críticas de seguridad en el sistema de sincronización entre la aplicación de escritorio y la aplicación móvil:

1. **Autenticación obligatoria** en todos los endpoints de sincronización
2. **Desencriptación on-demand** para servir archivos al móvil
3. **Almacenamiento seguro** de contraseñas en el móvil
4. **Validación de contraseña** antes de guardar configuración

---

## 🔴 Problemas Resueltos

### Problema 1: Acceso no autorizado a endpoints de sincronización
**Antes:** Cualquiera con la IP del servidor podía:
- Descargar todas las fotos sin autenticación
- Obtener metadatos (lista de estudiantes, evidencias, etc.)
- Ver información sensible sin restricciones

**Ahora:**
- Todos los endpoints requieren contraseña
- Las peticiones incluyen header `Authorization: Bearer {password}`
- Solo usuarios con la contraseña correcta pueden sincronizar

### Problema 2: Imágenes encriptadas servidas al móvil
**Antes:** El servidor enviaba archivos `.enc` encriptados al móvil, que no podía leerlos

**Ahora:**
- El servidor desencripta automáticamente en memoria (RAM)
- Envía el archivo desencriptado al móvil
- Los archivos NUNCA se desencriptan en disco

### Problema 3: Contraseña almacenada en texto plano
**Antes:** No había sistema de autenticación en el móvil

**Ahora:**
- Contraseña almacenada usando `flutter_secure_storage`
- Encriptación nativa del sistema operativo
- Validación antes de guardar

---

## 🏗️ Cambios Implementados

### Backend (Escritorio)

#### 1. Middleware de Autenticación (`server.js`)
```javascript
async function authenticateSyncRequest(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Autenticación requerida' });
  }

  const password = authHeader.substring(7);
  const isValid = await passwordManager.verifyPassword(password);

  if (!isValid) {
    return res.status(403).json({ error: 'Contraseña incorrecta' });
  }

  req.syncPassword = password;
  next();
}
```

**Aplicado a:**
- `GET /api/sync/metadata`
- `POST /api/sync/push`
- `POST /api/sync/files` (upload)
- `GET /api/sync/files/:filename` (download)

#### 2. Desencriptación On-Demand (`server.js`)
```javascript
app.get('/api/sync/files/:filename', authenticateSyncRequest, async (req, res) => {
  const password = req.syncPassword;

  // Si existe encriptado, desencriptar en memoria
  if (fs.existsSync(encryptedFilepath)) {
    const fileBuffer = await decryptionCache.get(filepath, password);

    res.set('Content-Type', mimeType);
    res.send(fileBuffer); // Servir desde memoria
  }
});
```

**Características:**
- Usa el cache de desencriptación existente
- Desencripta solo en RAM, nunca en disco
- Determina automáticamente el tipo MIME
- Soporta imágenes, videos y audio

---

### Frontend (Móvil)

#### 1. Servicio de Almacenamiento Seguro
**Archivo nuevo:** `lib/core/services/sync_password_storage.dart`

```dart
class SyncPasswordStorage {
  final FlutterSecureStorage _storage;

  Future<bool> savePassword(String password) async {...}
  Future<String?> getPassword() async {...}
  Future<bool> deletePassword() async {...}
  Future<bool> hasPassword() async {...}
}
```

#### 2. Headers de Autenticación (`sync_service.dart`)
```dart
class SyncService {
  String? _password;

  void setPassword(String password) {
    _password = password;
  }

  Map<String, String> _getAuthHeaders() {
    return {'Authorization': 'Bearer $_password'};
  }

  // Aplicado a todos los métodos:
  // - getMetadata()
  // - pushMetadata()
  // - uploadFile()
  // - downloadFile()
}
```

#### 3. Validación de Contraseña (`sync_service.dart`)
```dart
Future<bool> validatePassword(String baseUrl, String password) async {
  _password = password;
  try {
    await getMetadata(baseUrl); // Intenta autenticarse
    return true;
  } catch (e) {
    return false;
  }
}
```

#### 4. UI de Configuración (`sync_settings_screen.dart`)
**Nuevos campos:**
- Campo de contraseña con visibilidad toggleable
- Botón "Validar contraseña" (verifica contra servidor)
- Indicador visual de contraseña validada
- Guardado solo si la contraseña es correcta

**Flujo de usuario:**
1. Ingresar IP del servidor
2. Ingresar contraseña del escritorio
3. Clic en "Validar contraseña"
4. Si es correcta ✅ → habilita "Guardar"
5. Si es incorrecta ❌ → muestra error

#### 5. Integración Automática (`sync_repository.dart`)
```dart
Future<void> _ensurePasswordConfigured() async {
  final password = await _passwordStorage.getPassword();
  if (password == null) {
    throw SyncException('Password not configured');
  }
  _syncService.setPassword(password);
}

// Llamado automáticamente antes de syncAll()
```

---

## 🔒 Seguridad

### Flujo de Autenticación

```
┌─────────────┐                                    ┌─────────────┐
│   MÓVIL     │                                    │  ESCRITORIO │
└─────────────┘                                    └─────────────┘
       │                                                   │
       │  1. Usuario ingresa contraseña en móvil          │
       │────────────────────────────────────────────────► │
       │                                                   │
       │  2. GET /api/sync/metadata                       │
       │     Header: Authorization: Bearer {password}     │
       │────────────────────────────────────────────────► │
       │                                                   │
       │                         3. Valida con PBKDF2     │
       │                            (100,000 iteraciones) │
       │                                                   │
       │  4. Respuesta (200 OK) o (403 Forbidden)         │
       │◄──────────────────────────────────────────────── │
       │                                                   │
       │  5. Si válida: Guarda en flutter_secure_storage  │
       │     (Encriptación nativa del SO)                 │
       │                                                   │
```

### Capas de Protección

1. **Capa de Red:** HTTPS recomendado en producción
2. **Capa de Aplicación:** Header Authorization con Bearer token
3. **Capa de Verificación:** PBKDF2-SHA512 con 100,000 iteraciones
4. **Capa de Almacenamiento:** flutter_secure_storage (móvil) + solo RAM (escritorio)
5. **Capa de Archivos:** AES-256-GCM para archivos en disco

---

## 📝 Archivos Modificados

### Backend (Escritorio)
- ✅ `src/server.js` - Middleware de autenticación + desencriptación on-demand

### Frontend (Móvil)
- ✅ `lib/core/services/sync_service.dart` - Headers de autenticación
- ✅ `lib/core/services/sync_password_storage.dart` - **NUEVO** almacenamiento seguro
- ✅ `lib/features/sync/data/repositories/sync_repository.dart` - Integración de password
- ✅ `lib/features/sync/presentation/providers/sync_providers.dart` - Providers actualizados
- ✅ `lib/features/sync/presentation/screens/sync_settings_screen.dart` - UI de contraseña

---

## 🧪 Testing

### Test 1: Validar autenticación requerida
```bash
# Sin contraseña - Debe fallar
curl http://192.168.1.100:3000/api/sync/metadata
# Respuesta esperada: 401 Unauthorized

# Con contraseña incorrecta - Debe fallar
curl -H "Authorization: Bearer wrongpass" http://192.168.1.100:3000/api/sync/metadata
# Respuesta esperada: 403 Forbidden

# Con contraseña correcta - Debe funcionar
curl -H "Authorization: Bearer eduportfolio" http://192.168.1.100:3000/api/sync/metadata
# Respuesta esperada: 200 OK + JSON metadata
```

### Test 2: Validar desencriptación de archivos
```bash
# Descargar imagen encriptada desde móvil
1. Abrir app móvil
2. Configurar sincronización con contraseña correcta
3. Sincronizar
4. Verificar que las imágenes se muestran correctamente
5. Verificar en escritorio que los archivos siguen con extensión .enc
```

### Test 3: Validar almacenamiento seguro
```bash
# En el móvil:
1. Configurar contraseña de sync
2. Cerrar app completamente
3. Reabrir app
4. Hacer sincronización
5. Debe funcionar sin pedir contraseña de nuevo (guardada)
```

### Test 4: Validar validación de contraseña
```bash
# En el móvil:
1. Ir a configuración de sync
2. Ingresar IP correcta
3. Ingresar contraseña INCORRECTA
4. Clic en "Validar contraseña"
5. Debe mostrar error y NO permitir guardar
6. Cambiar a contraseña correcta
7. Clic en "Validar contraseña"
8. Debe mostrar éxito ✅
9. Botón "Guardar" ahora habilitado
```

---

## ⚠️ Importante

### Migración de Usuarios Existentes
Si ya tienes la app móvil configurada:
1. Ve a Configuración de Sincronización
2. Ingresa la contraseña del servidor de escritorio
3. Valida la contraseña
4. Guarda la configuración

### Contraseña Predeterminada
La contraseña predeterminada del escritorio es: `eduportfolio`

**¡CÁMBIALA EN PRODUCCIÓN!**
- Panel del Docente (P) → Seguridad → Cambiar contraseña

### Backup
Haz backup de:
- `data/.password` (hash de contraseña del escritorio)
- Base de datos del móvil (si se pierde, se puede re-sincronizar)

---

## 🔮 Mejoras Futuras (Opcionales)

1. **Expiración de sesión:** Tokens JWT con tiempo de vida limitado
2. **2FA:** Código de verificación al emparejar
3. **Certificados SSL:** HTTPS obligatorio
4. **Whitelist de IPs:** Solo permitir ciertos dispositivos
5. **Logs de auditoría:** Registrar todos los intentos de sincronización

---

## 📞 Soporte

Si tienes problemas:
1. Verifica que el servidor de escritorio esté autenticado (login realizado)
2. Verifica que la contraseña sea correcta
3. Revisa los logs del servidor para errores de autenticación
4. Comprueba que estés en la misma red Wi-Fi

---

**Implementado por:** Antonio Sánchez León con Claude Code
**Versión:** 3.2 - Sync Security & Decryption
**Estado:** ✅ Completado
