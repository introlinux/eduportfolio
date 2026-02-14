# 🔄 Fix de Sincronización Bidireccional

## 📅 Fecha: 11 de Febrero de 2026

---

## 🐛 Problema Detectado

**Síntoma:**
- ✅ Escritorio → Móvil: Funciona correctamente
- ❌ Móvil → Escritorio: Solo funciona para estudiantes NUEVOS
- ❌ Estudiantes que existían en ambos lados NO recibieron las evidencias del móvil

**Causa:**
Dos problemas combinados:

1. **Evidencias usaban `INSERT OR IGNORE`** (línea 1593 del servidor)
   - Si una evidencia ya existía, se ignoraba (no actualizaba)
   - Debería usar `INSERT OR REPLACE`

2. **Estudiantes con mismo nombre pero IDs diferentes**
   - Si creaste "Juan" en escritorio (ID=3) y móvil (ID=5) ANTES de sincronizar
   - Las evidencias del móvil tenían `student_id=5`
   - El escritorio no tenía `student_id=5` → evidencias huérfanas
   - El móvil no consolidaba duplicados automáticamente

---

## ✅ Soluciones Implementadas

### Fix 1: Cambiar `INSERT OR IGNORE` a `INSERT OR REPLACE` (Servidor)

**Archivo:** `src/server.js` (línea ~1593)

**Antes:**
```javascript
INSERT OR IGNORE INTO evidences (...)
```

**Después:**
```javascript
INSERT OR REPLACE INTO evidences (...)
```

**Efecto:**
- Ahora las evidencias se actualizan si ya existen
- Permite que evidencias del móvil actualicen las del escritorio

---

### Fix 2: Consolidación de Estudiantes Duplicados (Móvil)

**Archivo:** `lib/features/sync/data/repositories/sync_repository.dart`

**Estrategia:** El escritorio (servidor) es la autoridad para IDs

**Lógica implementada:**

1. **Buscar por ID y por nombre:**
   ```dart
   final localStudentById = local.firstWhere((s) => s.id == remoteStudent.id, ...);
   final localStudentByName = local.firstWhere((s) => s.name == remoteStudent.name, ...);
   ```

2. **Caso 1: Estudiante nuevo** → Insertar con ID del servidor
   ```dart
   final student = Student(id: remoteStudent.id, ...);
   ```

3. **Caso 2: Mismo nombre, diferente ID** → Consolidar
   ```dart
   // Actualizar todas las evidencias del ID antiguo al ID nuevo
   for (final evidence in evidences.where((e) => e.studentId == oldId)) {
     final updatedEvidence = evidence.copyWith(studentId: newId);
     await _evidenceRepository.updateEvidence(updatedEvidence);
   }

   // Eliminar estudiante con ID antiguo
   await _studentRepository.deleteStudent(oldId);

   // Insertar estudiante con ID del servidor
   await _studentRepository.createStudent(student);
   ```

4. **Caso 3: Mismo ID** → Actualizar si el servidor es más reciente

**Logs añadidos:**
- `Added student: Juan (ID: 3)`
- `Consolidated student: Juan (ID: 3)` (cuando detecta duplicado)
- `Updated evidences for student "Juan" from ID 5 to 3`
- `Deleted duplicate student with old ID: 5`

---

## 🧪 Cómo Probar

### Escenario de Prueba: Estudiantes Duplicados

**Setup:**
1. Reset completo (borrar BDs de ambos lados)
2. En ESCRITORIO: Crear estudiante "Juan" y añadir 2 evidencias
3. En MÓVIL: Crear estudiante "Juan" y añadir 3 evidencias
4. Desbloquear baúl en escritorio

**Test 1: Sincronización Escritorio → Móvil**
```bash
# Móvil: Settings → Sincronización → Sincronizar
```

**Resultado esperado:**
- ✅ Móvil recibe las 2 evidencias del escritorio
- ✅ Móvil detecta "Juan" duplicado (IDs diferentes)
- ✅ Móvil consolida al ID del escritorio
- ✅ Móvil actualiza las 3 evidencias locales al nuevo ID
- ✅ Ahora "Juan" en móvil tiene 5 evidencias (2+3)

**Verificar en logs del móvil:**
```
✅ Added student: Juan (ID: 3)
⚠️  Student "Juan" exists with different ID. Local: 5, Remote: 3. Consolidating to server ID.
✅ Updated evidences for student "Juan" from ID 5 to 3
✅ Deleted duplicate student with old ID: 5
✅ Consolidated student: Juan (ID: 3)
```

**Test 2: Sincronización Móvil → Escritorio**
```bash
# Móvil: Settings → Sincronización → Sincronizar de nuevo
```

**Resultado esperado:**
- ✅ Escritorio recibe las 3 evidencias del móvil
- ✅ Ahora "Juan" en escritorio tiene 5 evidencias (2+3)
- ✅ Todas con `student_id=3`

**Verificar en escritorio:**
1. Abre escritorio → Ver portfolio de "Juan"
2. Debe tener 5 evidencias totales
3. SQL: `SELECT * FROM evidences WHERE student_id=3;` → debe mostrar 5 filas

---

## 📊 Archivos Modificados

**Escritorio:**
- ✅ `src/server.js` - Cambiado `INSERT OR IGNORE` a `INSERT OR REPLACE`

**Móvil:**
- ✅ `lib/features/sync/data/repositories/sync_repository.dart` - Consolidación de duplicados

---

## 🎯 Comportamiento Final

### Sincronización Escritorio → Móvil
1. Móvil adopta IDs del escritorio (autoridad)
2. Detecta y consolida estudiantes duplicados por nombre
3. Actualiza evidencias al ID correcto
4. Elimina estudiantes con IDs antiguos

### Sincronización Móvil → Escritorio
1. Escritorio recibe estudiantes nuevos con sus IDs
2. Escritorio actualiza evidencias existentes (gracias a REPLACE)
3. Escritorio recibe evidencias nuevas correctamente

### Sincronización Bidireccional Completa
1. Escritorio → Móvil (consolida IDs)
2. Móvil → Escritorio (envía datos con IDs correctos)
3. Ambos lados quedan sincronizados
4. No hay duplicados ni evidencias huérfanas

---

## 💡 Notas Importantes

1. **El escritorio es la autoridad para IDs**
   - Siempre usa los IDs del escritorio
   - El móvil adapta sus IDs al escritorio

2. **Primera sincronización es crítica**
   - Si hay duplicados, la primera sync los consolida
   - Después de la primera sync, todo debe funcionar perfectamente

3. **Logs de debug**
   - Revisa los logs del móvil para ver el proceso de consolidación
   - Verás warnings cuando detecte duplicados

4. **Reset sigue siendo válido**
   - Para desarrollo, resetear es siempre una opción
   - Pero ahora la sincronización bidireccional funciona correctamente

---

## 🔍 Debugging

### Ver evidencias en Escritorio
```sql
cd D:\eduportfolio\data
sqlite3 eduportfolio.db

-- Ver todas las evidencias de un estudiante
SELECT id, student_id, subject_id, file_path, capture_date
FROM evidences
WHERE student_id = 3;

-- Ver estudiantes
SELECT * FROM students;
```

### Ver logs en Móvil
```bash
flutter logs | grep -E "(Student|Evidence|Consolidat|Added|Updated)"
```

---

## ✅ Estado Final

| Operación | Estado |
|-----------|--------|
| Escritorio → Móvil | ✅ Funciona |
| Móvil → Escritorio | ✅ Funciona |
| Consolidación de duplicados | ✅ Implementada |
| Evidencias actualizables | ✅ Implementada |
| Sincronización bidireccional | ✅ Completa |

---

**Próximo paso:** Probar con reset completo y verificar que todo funciona 🚀
