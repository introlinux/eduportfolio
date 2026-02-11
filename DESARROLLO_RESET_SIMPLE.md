# 🔧 Guía de Desarrollo - Reset y Pruebas Limpias

## 🎯 Filosofía: Entorno Limpio en Desarrollo

Como estamos en desarrollo local, **NO necesitamos** scripts de limpieza ni migraciones complejas.
**Simplemente reseteamos y empezamos de cero** para tener datos consistentes.

---

## ✅ Fixes de Código Implementados

### 1. **Sincronización de Asignaturas** (`sync_repository.dart`)
✅ Ahora usa el ID del servidor remoto en lugar de auto-incrementar
✅ Detecta y maneja duplicados durante el sync
✅ Añadido logging para debug

### 2. **Protección del Dropdown** (`evidence_detail_screen.dart`)
✅ Elimina duplicados antes de mostrar
✅ Valida que el ID existe en la lista
✅ Mismo fix para estudiantes

**Estos fixes ya están aplicados y funcionan correctamente.**

---

## 🧹 Resetear Todo (Empezar de Cero)

### Paso 1: Limpiar Base de Datos del Escritorio

```bash
# Ir al directorio del escritorio
cd D:\eduportfolio

# Opción A: Borrar solo la base de datos
rm data/eduportfolio.db

# Opción B: Borrar TODO (BD + imágenes)
rm -rf data/
rm -rf portfolios/

# El servidor las recreará automáticamente al arrancar
npm start
```

### Paso 2: Limpiar Base de Datos del Móvil

**Opción A - Borrar app del dispositivo/emulador:**
- Desinstala la app completamente
- Reinstala con `flutter run`

**Opción B - Programático (añade este código temporal):**
```dart
// En main.dart, ANTES de runApp()
import 'package:eduportfolio/core/database/database_helper.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // ⚠️ SOLO PARA DESARROLLO - Borra la BD al arrancar
  await DatabaseHelper.instance.deleteDb();

  runApp(MyApp());
}
```

**Opción C - Desde la UI (si quieres añadir un botón):**
Puedes añadir un botón de "Reset Database" en Settings que llame a:
```dart
await DatabaseHelper.instance.deleteDb();
// Luego restart la app
```

### Paso 3: Primera Sincronización Limpia

1. **Escritorio:**
   ```bash
   cd D:\eduportfolio
   npm start
   ```
   - Abre http://localhost:3000
   - Inicia sesión
   - **DESBLOQUEA EL BAÚL** (importante para que se guarden imágenes)
   - Crea algunos estudiantes de prueba
   - Añade algunas evidencias de prueba

2. **Móvil:**
   ```bash
   cd D:\eduportfolio-mobile
   flutter run
   ```
   - Ve a Settings → Sincronización
   - Conecta con el escritorio
   - Sincroniza

3. **Verificar:**
   - Los estudiantes deben aparecer con los **mismos IDs** que en el escritorio
   - Las asignaturas deben aparecer con los **mismos IDs** que en el escritorio
   - Abre una evidencia → dropdown debe funcionar sin errores
   - Las imágenes deben cargarse correctamente

---

## 🐛 Si Encuentras Bugs

### Debug en el Móvil
```bash
# Ver logs en tiempo real
flutter logs | grep -E "(Sync|Subject|Student|ERROR)"
```

Busca líneas como:
- `✅ Added subject: Matemáticas (ID: 1)` → Bien, usa ID del servidor
- `❌ Subject already synced` → Bien, no crea duplicados
- `ERROR` → Algo falla, mira el stack trace

### Debug en el Escritorio
En la consola de Node.js:
- `✅ Asignatura añadida` → Todo bien
- `Error sincronizando evidencia` → Mira qué evidencia falla
- `El baúl está bloqueado` → Desbloquea antes de sincronizar

### Debugging SQL (Escritorio)

```bash
# Entrar en la BD SQLite
cd D:\eduportfolio\data
sqlite3 eduportfolio.db

# Ver asignaturas
SELECT * FROM subjects ORDER BY id;

# Ver duplicados
SELECT name, COUNT(*) as count, GROUP_CONCAT(id) as ids
FROM subjects
GROUP BY name
HAVING COUNT(*) > 1;

# Salir
.quit
```

---

## 📋 Checklist de Pruebas Limpias

### Test 1: Sincronización Inicial (Escritorio → Móvil)
- [ ] Resetear BDs de escritorio y móvil
- [ ] Crear datos en escritorio
- [ ] Desbloquear baúl en escritorio
- [ ] Sincronizar desde móvil
- [ ] Verificar que IDs coinciden
- [ ] Verificar que dropdowns funcionan
- [ ] Verificar que imágenes cargan

### Test 2: Sincronización Bidireccional
- [ ] Añadir estudiante en móvil
- [ ] Sincronizar con escritorio
- [ ] Verificar que aparece en escritorio
- [ ] Añadir evidencia en escritorio
- [ ] Sincronizar con móvil
- [ ] Verificar que aparece en móvil

### Test 3: Manejo de Baúl
- [ ] Bloquear baúl en escritorio
- [ ] Intentar sincronizar desde móvil
- [ ] Verificar que da error 503
- [ ] Desbloquear baúl
- [ ] Sincronizar de nuevo
- [ ] Verificar que funciona

---

## 🚀 Comandos Útiles de Reset Rápido

### Reset Completo (Empezar de Cero)
```bash
# Escritorio
cd D:\eduportfolio
rm -rf data/ portfolios/
npm start

# Móvil
cd D:\eduportfolio-mobile
flutter clean
flutter pub get
flutter run
# Desinstalar app del emulador/dispositivo antes de ejecutar
```

### Reset Solo BDs (Mantener Código)
```bash
# Escritorio
cd D:\eduportfolio
rm data/eduportfolio.db

# Móvil - desinstalar y reinstalar app
```

---

## 💡 Consejos para Desarrollo

1. **Durante pruebas de sincronización:** Resetea ambas BDs para evitar inconsistencias
2. **Al cambiar esquema de BD:** Siempre resetea (no migres)
3. **Al cambiar lógica de sync:** Resetea para probar desde cero
4. **Antes de commit importante:** Haz una prueba con BDs limpias
5. **Baúl del escritorio:** Siempre desbloquéalo antes de sincronizar desde móvil

---

## 📊 Estado Actual

| Componente | Estado | Notas |
|------------|--------|-------|
| Sync de asignaturas | ✅ Fixed | Usa ID del servidor |
| Sync de estudiantes | ✅ OK | Ya usaba ID correcto |
| Sync de evidencias | ✅ OK | Funciona correctamente |
| Sync de archivos | ⚠️ Requiere | Baúl desbloqueado |
| Dropdown asignaturas | ✅ Fixed | Validación añadida |
| Dropdown estudiantes | ✅ Fixed | Validación añadida |

---

## 🎯 Siguiente Paso Recomendado

1. **Reset completo** de ambos sistemas
2. **Crear datos de prueba** en escritorio
3. **Sincronizar** por primera vez
4. **Verificar** que todo funciona sin errores
5. **Reportar** cualquier problema que encuentres

Si algo falla, simplemente reseteas y pruebas de nuevo. ¡Simple y directo! 🚀
