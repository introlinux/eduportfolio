# 📊 Análisis de Cobertura de Tests - EduPortfolio Desktop

**Fecha**: Febrero 2026  
**Propósito**: Evaluar la cobertura de tests actual y planificar mejoras para el TFM

---

## 🎯 Resumen Ejecutivo

| Categoría | Estado | Cobertura |
|-----------|--------|-----------|
| **Tests Unitarios** | ⚠️ Incompleto | ~30% |
| **Tests de Integración** | ⚠️ Incompleto | ~20% |
| **Tests End-to-End** | ❌ Ausente | 0% |
| **Framework** | ✅ Configurado | Jest 30.2.0 |
| **Módulos Críticos** | ⚠️ Parciales | 6/9 módulos |

---

## 📦 Análisis por Módulo

### ✅ MÓDULOS CON TESTS (Parciales)

#### 1. **faceDatabase.js** (439 líneas)
- **Coverage**: ~60%
- **Tests Unitarios**: `tests/unit/faceDatabase.test.js`
  - ✅ `calculateDistance()` - 2 tests
  - ✅ `saveFaceProfile()` - 2 tests
  - ✅ `findMatchingStudent()` - 1 test
- **Tests de Integración**: `tests/integration/face_integration.test.js`
  - ✅ Full Flow: Save → Find Match - 2 tests
- **Faltan**: Tests para `logRecognition()`, `getAllStudents()`, `updateRecognitionHistory()`, Edge cases

#### 2. **crypto-manager.js** (193 líneas)
- **Coverage**: ~70%
- **Tests**: `test-encryption.js` (script manual, NO Jest)
  - ✅ Buffer encryption/decryption
  - ✅ Wrong password handling
  - ✅ File encryption/decryption
  - ✅ Corrupted data detection
- **Problema**: Tests está en script manual con colores ANSI, no es Jest
- **Faltan**: Refactorizar a Jest, tests para key derivation, salt validation

#### 3. **password-manager.js** (180 líneas)
- **Coverage**: ~40%
- **Tests**: Parcialmente en `test-encryption.js`
  - ✅ `setPassword()`
  - ✅ `verifyPassword()` (correcta e incorrecta)
  - ✅ `changePassword()`
- **Faltan**: Tests unitarios Jest, `hasPassword()`, `initializeDefaultPassword()`, edge cases

#### 4. **portfolio-vault.js** (197 líneas)
- **Coverage**: ~20%
- **Tests**: Minimal en `test-encryption.js`
  - ✅ `lockVault()`
  - ✅ `unlockVault()`
- **Faltan**: Tests unitarios Jest, `getAllImageFiles()`, estado lock, validaciones

---

### ❌ MÓDULOS SIN TESTS (Críticos)

#### 5. **decryption-cache.js** (247 líneas)
- **Coverage**: 0%
- **Criticidad**: 🔴 ALTA (gestiona memoria y seguridad)
- **Métodos sin tests**: 
  - `get()` - Getter del cache con LRU
  - `_put()` - Insertar en cache
  - `_moveToFront()` - Mover a frente (LRU)  
  - `_remove()` - Remover de cache
  - `clear()` - Limpiar cache
  - `getStats()` - Estadísticas
  - Todas las validaciones

#### 6. **server.js** (2896 líneas)
- **Coverage**: ~5%
- **Criticidad**: 🔴 ALTA (endpoints críticos)
- **Endpoints sin tests**:
  - POST `/api/authenticate` - Autenticación
  - POST `/api/portfolio/upload` - Carga de archivos
  - GET `/api/portfolio/:folder` - Obtener portfolio
  - POST `/api/faces/train` - Entrenar cara
  - GET `/api/faces/recognition` - Reconocimiento facial
  - POST `/api/vault/lock` - Bloquear cofre
  - POST `/api/vault/unlock` - Desbloquear cofre
  - GET `/api/students` - Listar estudiantes
  - Manejo de errores y autenticación

#### 7. **main.js** (Electron app)
- **Coverage**: 0%
- **Nota**: Difícil de testear sin Spectron, deprioritizado

---

## 🧪 Estado de los Tests Actuales

### Tests Manuales (NO Jest)
```
📁 test-encryption.js (372 líneas)
   ├── Test 1: Buffer encryption/decryption ✅
   ├── Test 2: Wrong password ✅
   ├── Test 3: Password manager ✅
   ├── Test 4: File encryption ✅
   ├── Test 5: Portfolio encryption ✅
   └── Test 6: Comprehensive flow ✅
   
📁 tests.js (272 líneas)
   ├── API tests generales (sin estructurar)
   
📁 test_train.js (27 líneas)
   └── Test simple de entrenamiento
   
📁 test-encryption.js (372 líneas)
   └── Tests de encriptación manual
```

### Tests Jest (Configurados correctamente)
```
📁 tests/
   ├── unit/
   │   └── faceDatabase.test.js ✅ (86 líneas, 5 tests)
   └── integration/
       └── face_integration.test.js ✅ (83 líneas, 2 tests)
       
Total: 7 tests estruturados con Jest
```

---

## 📋 Plan de Mejora Priorizado

### 🔴 CRÍTICO (Semana 1)
1. **Crear tests unitarios Jest para modules seguros**
   - password-manager.js (15 tests)
   - crypto-manager.js refactorizado (18 tests)
   - decryption-cache.js (20 tests)
   
2. **Crear tests de integración**
   - portfolio-vault.js con file system real (12 tests)
   - server endpoints autenticación (10 tests)

### 🟡 IMPORTANTE (Semana 2)
3. **Crear tests de endpoints**
   - Portfolio management (10 tests)
   - Face recognition flow (8 tests)
   - Vault operations (8 tests)

4. **Criar test utilities y mocks**
   - Mock de API
   - Mock de base datos
   - Test fixtures

### 🟢 OPCIONAL (Semana 3)
5. **Refactorizar tests manuales a Jest**
6. **Crear tests E2E con Spectron**
7. **Coverage reports y CI/CD**

---

## 📐 Configuración Jest (Existente)

```json
{
  "devDependencies": {
    "jest": "^30.2.0"
  },
  "scripts": {
    "test": "jest"
  }
}
```

**Estado**: ✅ Instalado pero no configurado en `jest.config.js`

---

## 🎯 Métricas Objetivo (TFM)

| Métrica | Actual | Objetivo |
|---------|--------|----------|
| Nº de tests | 7 | 100+ |
| Líneas testeadas | ~500 | >3000 |
| Cobertura unitaria | 30% | 80%+ |
| Cobertura integración | 20% | 60%+ |
| Tests críticos | 7 | 50+ |

---

## 📁 Estructura Propuesta

```
tests/
  ├── __mocks__/              # Mocks globales
  │   ├── database.mock.js
  │   ├── fs.mock.js
  │   └── crypto.mock.js
  ├── fixtures/               # Datos de prueba
  │   ├── test-images/
  │   ├── test-portfolios/
  │   └── test-data.js
  ├── unit/
  │   ├── password-manager.test.js      # NUEVO
  │   ├── crypto-manager.test.js        # MEJORADO
  │   ├── portfolio-vault.test.js       # NUEVO
  │   ├── decryption-cache.test.js      # NUEVO
  │   ├── faceDatabase.test.js          # EXISTENTE
  │   └── face-recognition.test.js      # NUEVO
  ├── integration/
  │   ├── face_integration.test.js      # EXISTENTE
  │   ├── encryption-flow.test.js       # NUEVO
  │   ├── vault-operations.test.js      # NUEVO
  │   └── server-auth.test.js           # NUEVO
  ├── e2e/
  │   └── full-workflow.test.js         # NUEVO (opcional)
  ├── setup.js                          # Setup global
  └── teardown.js                       # Teardown global
  
jest.config.js                          # Configuración Jest
```

---

## ✅ Siguientes Pasos

1. ✅ Crear `jest.config.js` con configuración correta
2. ✅ Crear tests unitarios por módulo (orden: contraseña → crypto → vault → cache)
3. ✅ Crear tests de integración para flujos críticos
4. ✅ Migrar tests manuales a Jest
5. ✅ Crear documento de standards de testing
6. ✅ Actualizar README con instrucciones de testing
7. ✅ Generar coverage reports

---

## 📚 Referencias AGENTS.md

Según la filosofía del proyecto:
- ✅ Ciclo TDD (Red → Green → Refactor)
- ✅ Pirámide de testing (muchos unitarios, pocos E2E)
- ✅ Tests = Requisito obligatorio (sin tests = roto)
- ✅ Nombres descriptivos (test descriptions claras)
- ✅ Mocking y aislamiento de dependencias
