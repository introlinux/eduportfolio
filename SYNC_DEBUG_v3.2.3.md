# 🔍 Debugging de Sincronización - Versión 3.2.3

**Fecha:** 2026-02-11
**Fix:** Preservación de curso activo durante consolidación

---

## 🐛 Problema Reportado

### Escenario de Prueba del Usuario:
1. ✅ Escritorio: Crea estudiantes "UNO" y "DOS"
2. ✅ Móvil: Crea curso "Curso 2025-26" (mismo nombre que escritorio)
3. ✅ Móvil: Sincroniza → "UNO" y "DOS" aparecen correctamente
4. ❌ Móvil: Crea estudiante "TRES" → dice "creado correctamente" pero NO aparece
5. ❌ Móvil: Crea "TRES" de nuevo → dice "creado correctamente" pero NO aparece
6. ⚠️ Móvil: Cierra y reabre app → "UNO" y "DOS" desaparecen, "TRES" aparece DUPLICADO
7. ✅ Móvil: Ahora SÍ puede crear estudiantes y aparecen inmediatamente
8. ❌ Móvil: Sincroniza de nuevo → "UNO" y "DOS" NO aparecen

---

## 🔍 Análisis de la Causa Raíz

### Problema #1: Pérdida del Curso Activo

**Causa:**
Cuando se consolida un curso local con uno remoto:
- Curso local: ID=1, `isActive=true` (único curso en móvil)
- Curso remoto: ID=2, `isActive=false` (puede haber otros cursos en servidor)
- Al consolidar, se usaba `isActive` del servidor → **curso quedaba inactivo**

**Consecuencia:**
- `getActiveCourse()` devuelve `null`
- Estudiantes creados localmente no se pueden asociar a ningún curso
- O se asocian a un curso incorrecto

**Fix Implementado:**
```dart
// Preservar local isActive status si el usuario lo marcó como activo
final bool shouldBeActive = localCourse.isActive || remoteCourse.isActive;

final course = Course(
  id: newId,
  name: remoteCourse.name,
  // ...
  isActive: shouldBeActive, // ✅ Preserva activo si local estaba activo
  // ...
);
```

### Problema #2: Provider con Valor Cacheado

**Causa:**
`filteredStudentsProvider` intentaba leer el curso activo de forma síncrona:
```dart
// ANTES:
final activeCourseAsync = ref.watch(activeCourseProvider);
effectiveCourseId = activeCourseAsync.value?.id;  // ❌ Solo lee cache
```

Si `activeCourseProvider` no estaba cargado, `.value` devuelve `null`.

**Fix Implementado:**
```dart
// AHORA:
final activeCourse = await ref.watch(activeCourseProvider.future);
effectiveCourseId = activeCourse?.id;  // ✅ Espera valor real
```

---

## 📋 Archivos Modificados

### 1. `sync_repository.dart` (línea ~270)
**Cambio:** Preservar `isActive` del curso local durante consolidación

### 2. `student_providers.dart` (línea ~79)
**Cambio:** Await correcto de `activeCourseProvider` en `filteredStudentsProvider`

---

## 🧪 Pasos para Probar el Fix

### Test 1: Curso Local + Sincronización
```
1. Desinstalar app móvil (limpiar BD)
2. Reinstalar app móvil
3. Crear curso "Curso 2025-26" en móvil
4. Verificar que aparece como activo
5. En escritorio: Tener el mismo curso "Curso 2025-26" con estudiantes "UNO" y "DOS"
6. En móvil: Sincronizar

RESULTADO ESPERADO:
✅ "UNO" y "DOS" aparecen en lista de estudiantes
✅ Curso sigue activo (verificar en configuración)
✅ No hay errores en logs
```

### Test 2: Crear Estudiante Localmente Después de Sync
```
1. Continuar del Test 1
2. En móvil: Ir a "Añadir estudiante"
3. Crear estudiante "TRES"

RESULTADO ESPERADO:
✅ Mensaje "Estudiante creado correctamente"
✅ "TRES" aparece INMEDIATAMENTE en la lista (sin reiniciar)
✅ "UNO" y "DOS" siguen apareciendo
```

### Test 3: Sincronización Bidireccional
```
1. Continuar del Test 2
2. En móvil: Crear estudiante "CUATRO"
3. Verificar que aparece
4. En móvil: Sincronizar de nuevo

RESULTADO ESPERADO:
✅ "UNO", "DOS", "TRES" y "CUATRO" siguen apareciendo
✅ No hay duplicados
✅ En escritorio (después de recargar): aparecen "TRES" y "CUATRO"
```

### Test 4: Reiniciar App
```
1. Continuar del Test 3
2. Cerrar app móvil completamente
3. Abrir app móvil de nuevo
4. Ir a vista de estudiantes

RESULTADO ESPERADO:
✅ Todos los estudiantes aparecen ("UNO", "DOS", "TRES", "CUATRO")
✅ No hay duplicados
✅ Curso sigue activo
```

---

## 📊 Logs a Revisar

Durante las pruebas, buscar estos mensajes en los logs del móvil:

### Durante Sincronización:
```
✅ Course "Curso 2025-26" exists with different ID. Local: 1, Remote: 2. Consolidating to server ID.
✅ Updated students and evidences for course "Curso 2025-26" from ID 1 to 2
✅ Deleted duplicate course with old ID: 1
✅ Consolidated course: Curso 2025-26 (ID: 2, isActive: true)
```

### Durante Creación de Estudiante:
```
✅ Student created with ID: X
```

### Durante Consulta de Estudiantes:
```
✅ Querying students for course ID: 2
✅ Found X students
```

---

## ⚠️ Problemas Conocidos Pendientes

### 1. Estudiantes Duplicados
**Síntoma:** Si se crea un estudiante varias veces antes del fix, puede haber duplicados

**Solución Manual:**
- Desde el móvil: editar/eliminar duplicados manualmente
- O desinstalar app y volver a sincronizar

**Solución Futura:**
- Agregar validación en el formulario para no permitir nombres duplicados en el mismo curso

### 2. Sincronización Unidireccional Inicial
**Síntoma:** En la primera sincronización, si hay estudiantes locales creados antes de sincronizar, se crean duplicados en el servidor

**Causa:** El servidor no puede detectar duplicados por nombre porque no tiene contexto completo

**Solución Futura:**
- Mejorar lógica de push para detectar y consolidar estudiantes existentes

---

## 🔧 Debugging Avanzado

### Ver Curso Activo en Móvil
```dart
// Agregar temporalmente en student_form_screen.dart antes de crear estudiante:
final activeCourse = await ref.read(courseRepositoryProvider).getActiveCourse();
print('🔍 DEBUG: Active course = ${activeCourse?.id} - ${activeCourse?.name} - isActive=${activeCourse?.isActive}');
```

### Ver Estudiantes en BD
```bash
# Android
adb shell
cd /data/data/com.example.eduportfolio/databases/
sqlite3 eduportfolio.db
SELECT * FROM courses;
SELECT * FROM students;
.quit
exit
```

### Ver Logs Detallados
```bash
# Filtrar logs de sincronización
adb logcat | grep -i "sync\|consolidat\|student"
```

---

## 💡 Recomendaciones para el Usuario

1. **Limpieza Antes de Probar:**
   - Desinstalar app móvil completamente
   - Reinstalar desde cero
   - Esto elimina cualquier estado corrupto de pruebas anteriores

2. **Orden Recomendado:**
   - PRIMERO: Crear/poblar datos en escritorio
   - SEGUNDO: Crear curso en móvil con el mismo nombre
   - TERCERO: Sincronizar
   - CUARTO: Crear estudiantes localmente si es necesario

3. **Evitar:**
   - Crear muchos datos en móvil antes de primera sincronización
   - Esto puede causar conflictos de IDs más complejos

---

## 📞 Si el Problema Persiste

Si después de aplicar estos fixes, el problema continúa:

1. **Capturar Logs Completos:**
   ```bash
   adb logcat > sync_debug.log
   # Luego ejecutar las pruebas y revisar el archivo
   ```

2. **Exportar Base de Datos:**
   ```bash
   adb pull /data/data/com.example.eduportfolio/databases/eduportfolio.db
   # Luego inspeccionar con SQLite Browser
   ```

3. **Reportar:**
   - Logs completos de la sincronización
   - Estado de la BD antes y después
   - Pasos exactos para reproducir

---

**Implementado por:** Antonio Sánchez León con Claude Code
**Versión:** 3.2.3 - Active Course Preservation Fix
**Estado:** ✅ Listo para probar
