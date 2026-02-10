const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const faceDbModule = null; // Se cargará después de asegurar las carpetas

// === SISTEMA DE ENCRIPTACIÓN ===
const { PasswordManager, DEFAULT_PASSWORD } = require('./password-manager');
const { PortfolioVault } = require('./portfolio-vault');

const app = express();
const PORT = process.env.PORT || 3000;
const USER_DATA_PATH = process.env.USER_DATA_PATH;

// --- CONFIGURACIÓN DE RUTAS DE ARMEACENAMIENTO ---
// Si hay USER_DATA_PATH (Prod), usamos esa ruta. Si no (Dev), usamos la local del proyecto.
const BASE_DATA_PATH = USER_DATA_PATH || path.join(__dirname, '..');
const DATA_DIR = path.join(BASE_DATA_PATH, 'data');
const PORTFOLIOS_DIR = path.join(BASE_DATA_PATH, 'portfolios');
const PUBLIC_DIR = path.join(__dirname, '../public'); // El código estático siempre va con el bundle

// Asegurar que existan las carpetas de datos
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PORTFOLIOS_DIR)) fs.mkdirSync(PORTFOLIOS_DIR, { recursive: true });

// Inicializar sistema de encriptación
const passwordManager = new PasswordManager(DATA_DIR);
const portfolioVault = new PortfolioVault(PORTFOLIOS_DIR, DATA_DIR);

// Variable global para almacenar la contraseña actual (solo en memoria)
let currentPassword = null;
let isAuthenticated = false;

// Ahora cargamos el módulo de base de datos de rostros una vez las carpetas existen
const faceDb = require('./faceDatabase');

// 1. Configuración básica y middlewares
app.use(cors()); // Keep cors as it was not explicitly removed
app.use(express.json({ limit: '50mb' })); // Replaces bodyParser.json
app.use(express.urlencoded({ limit: '50mb', extended: true })); // Add express.urlencoded to replace bodyParser.urlencoded
app.use(express.static(PUBLIC_DIR));
app.use('/_temporal_', express.static(path.join(PORTFOLIOS_DIR, '_temporal_')));
app.use('/portfolios', express.static(PORTFOLIOS_DIR));
app.use('/models', express.static(path.join(PUBLIC_DIR, 'models')));

// Base de datos SQLite
const dbPath = path.join(DATA_DIR, 'eduportfolio.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error abriendo base de datos:', err);
  } else {
    console.log('✅ Base de datos SQLite conectada');
    initDatabase();
  }
});

// Inicializar base de datos
function initDatabase() {
  db.serialize(() => {
    // === TABLA DE CURSOS (nueva) ===
    db.run(`
      CREATE TABLE IF NOT EXISTS courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // === TABLA DE ASIGNATURAS (nueva) ===
    db.run(`
      CREATE TABLE IF NOT EXISTS subjects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT,
        icon TEXT,
        is_default INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // === TABLA DE ALUMNOS (actualizada) ===
    db.run(`
      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        course_id INTEGER,
        enrollmentDate DATETIME DEFAULT CURRENT_TIMESTAMP,
        isActive BOOLEAN DEFAULT 1,
        FOREIGN KEY(course_id) REFERENCES courses(id)
      )
    `);

    // === TABLA DE EVIDENCIAS (renombrada de captures) ===
    db.run(`
      CREATE TABLE IF NOT EXISTS evidences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER,
        course_id INTEGER,
        subject_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        thumbnail_path TEXT,
        file_size INTEGER,
        duration INTEGER,
        capture_date TEXT NOT NULL,
        is_reviewed INTEGER DEFAULT 1,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        confidence REAL,
        method TEXT,
        FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE SET NULL,
        FOREIGN KEY(course_id) REFERENCES courses(id),
        FOREIGN KEY(subject_id) REFERENCES subjects(id)
      )
    `);

    // === TABLA DE SESIONES (sin cambios) ===
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY,
        subject TEXT NOT NULL,
        startTime DATETIME DEFAULT CURRENT_TIMESTAMP,
        duration INTEGER DEFAULT 900,
        isActive BOOLEAN DEFAULT 1
      )
    `);

    // === MIGRACIONES DE DATOS ===

    // Migración 1: Poblar tabla de asignaturas con valores por defecto
    db.get("SELECT COUNT(*) as count FROM subjects", (err, row) => {
      if (!err && row.count === 0) {
        const defaultSubjects = [
          'Matemáticas',
          'Lengua',
          'Ciencias',
          'Inglés',
          'Artística'
        ];

        const stmt = db.prepare("INSERT INTO subjects (name, is_default) VALUES (?, 1)");
        defaultSubjects.forEach(subject => stmt.run(subject));
        stmt.finalize(() => {
          console.log('✅ Asignaturas por defecto creadas');
        });
      }
    });

    // Migración 2: Crear curso por defecto si no existe
    db.get("SELECT COUNT(*) as count FROM courses", (err, row) => {
      if (!err && row.count === 0) {
        const currentYear = new Date().getFullYear();
        db.run(
          "INSERT INTO courses (name, start_date, is_active) VALUES (?, ?, 1)",
          [`Curso ${currentYear}-${currentYear + 1}`, new Date().toISOString()],
          function (err) {
            if (!err) {
              console.log('✅ Curso por defecto creado');

              // Asignar todos los estudiantes existentes al curso por defecto
              db.run(
                "UPDATE students SET course_id = ? WHERE course_id IS NULL",
                [this.lastID],
                (err) => {
                  if (!err) {
                    console.log('✅ Estudiantes asignados al curso por defecto');
                  }
                }
              );
            }
          }
        );
      }
    });

    // Migración 3: Migrar datos de captures a evidences si captures existe y tiene datos
    db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='captures'", (err, tables) => {
      if (!err && tables.length > 0) {
        // La tabla captures existe, verificar si tiene datos
        db.get("SELECT COUNT(*) as count FROM captures", (err, row) => {
          if (!err && row && row.count > 0) {
            console.log(`🔄 Migrando ${row.count} registros de captures a evidences...`);

            // Migrar cada captura
            db.all("SELECT * FROM captures", (err, captures) => {
              if (err) {
                console.error('Error leyendo captures:', err);
                return;
              }

              captures.forEach(capture => {
                // Buscar o crear la asignatura
                db.get(
                  "SELECT id FROM subjects WHERE name = ?",
                  [capture.subject],
                  (err, subject) => {
                    let subjectId = subject ? subject.id : null;

                    // Si no existe la asignatura, crearla
                    if (!subjectId) {
                      db.run(
                        "INSERT INTO subjects (name, is_default) VALUES (?, 0)",
                        [capture.subject],
                        function (err) {
                          if (!err) {
                            subjectId = this.lastID;
                            insertEvidence(capture, subjectId);
                          }
                        }
                      );
                    } else {
                      insertEvidence(capture, subjectId);
                    }
                  }
                );
              });
            });
          }
        });
      }
    });

    function insertEvidence(capture, subjectId) {
      db.run(
        `INSERT INTO evidences (
          student_id, subject_id, type, file_path, capture_date, 
          confidence, method, is_reviewed, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          capture.studentId,
          subjectId,
          'IMG', // Asumir que todas las capturas antiguas son imágenes
          capture.imagePath,
          capture.captureDate || capture.timestamp,
          capture.confidence,
          capture.method,
          capture.isClassified ? 1 : 0,
          capture.captureDate || capture.timestamp
        ],
        (err) => {
          if (err) {
            console.error('Error migrando captura:', err);
          }
        }
      );
    }

    // Migración 4: Añadir columna course_id a students si no existe
    db.all("PRAGMA table_info(students)", (err, columns) => {
      if (!err) {
        const hasCourseId = columns.some(col => col.name === 'course_id');
        if (!hasCourseId) {
          db.run("ALTER TABLE students ADD COLUMN course_id INTEGER REFERENCES courses(id)", (err) => {
            if (!err) {
              console.log('✅ Columna course_id añadida a students');
            }
          });
        }
      }
    });

    // Migración 5: Añadir columna face_embeddings_192 a students si no existe (para soporte móvil)
    db.all("PRAGMA table_info(students)", (err, columns) => {
      if (!err) {
        const hasEmbeddings = columns.some(col => col.name === 'face_embeddings_192');
        if (!hasEmbeddings) {
          db.run("ALTER TABLE students ADD COLUMN face_embeddings_192 BLOB", (err) => {
            if (!err) {
              console.log('✅ Columna face_embeddings_192 añadida a students');
            }
          });
        }
      }
    });

    console.log('📊 Tablas de base de datos inicializadas y migradas');
  });
}

/**
 * Genera un nombre de carpeta seguro y descriptivo para el alumno
 * @param {number} id 
 * @param {string} name 
 * @returns {string}
 */
function getStudentFolderName(id, name) {
  if (!name) return `student_${id}`;

  // Limpiar nombre: quitar caracteres no permitidos en Windows
  // pero permitir tildes y eñes (UTF-8 en Windows 10/11 suele funcionar)
  const safeName = name
    .trim()
    .replace(/[<>:"/\\|?*]/g, '') // Quitar caracteres prohibidos en NTFS
    .replace(/\s+/g, '_');        // Cambiar espacios por guiones bajos

  return `${safeName}_${id}`;
}

/**
 * Genera el ID de asignatura (primeras 3 letras en mayúsculas)
 * Compatible con el formato móvil
 * @param {string} subjectName 
 * @returns {string}
 */
function generateSubjectId(subjectName) {
  const normalized = removeAccents(subjectName);
  const id = normalized.length >= 3
    ? normalized.substring(0, 3).toUpperCase()
    : normalized.toUpperCase().padRight(3, 'X');
  return id;
}

/**
 * Normaliza el nombre del estudiante reemplazando espacios con guiones
 * Compatible con el formato móvil
 * @param {string} name 
 * @returns {string}
 */
function normalizeStudentName(name) {
  const normalized = removeAccents(name);
  return normalized.replace(/\s+/g, '-');
}

/**
 * Elimina acentos de un texto
 * @param {string} text 
 * @returns {string}
 */
function removeAccents(text) {
  const withAccents = 'áéíóúÁÉÍÓÚñÑüÜ';
  const withoutAccents = 'aeiouAEIOUnNuU';

  let result = text;
  for (let i = 0; i < withAccents.length; i++) {
    result = result.replaceAll(withAccents[i], withoutAccents[i]);
  }

  return result;
}

// ==================== API ENDPOINTS ====================

// === ENDPOINTS DE AUTENTICACIÓN Y GESTIÓN DEL BAÚL ===

// 0.1. Verificar estado de autenticación
app.get('/api/auth/status', async (req, res) => {
  try {
    const hasPassword = await passwordManager.hasPassword();
    const vaultLocked = await portfolioVault.isLocked();

    res.json({
      hasPassword,
      isAuthenticated,
      vaultLocked,
      requiresSetup: !hasPassword
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 0.2. Configurar contraseña inicial (solo si no existe)
app.post('/api/auth/setup', async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Contraseña requerida' });
  }

  try {
    const result = await passwordManager.setPassword(password);

    if (result.success) {
      currentPassword = password;
      isAuthenticated = true;
      res.json({ success: true, message: 'Contraseña configurada correctamente' });
    } else {
      res.status(400).json({ success: false, message: result.message });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 0.3. Verificar contraseña (login)
app.post('/api/auth/login', async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Contraseña requerida' });
  }

  try {
    const isValid = await passwordManager.verifyPassword(password);

    if (isValid) {
      currentPassword = password;
      isAuthenticated = true;

      // Desbloquear baúl automáticamente
      const vaultResult = await portfolioVault.unlockVault(password);

      res.json({
        success: true,
        message: 'Autenticación exitosa',
        vaultUnlocked: vaultResult.success,
        filesDecrypted: vaultResult.filesDecrypted
      });
    } else {
      res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 0.4. Cambiar contraseña
app.post('/api/auth/change-password', async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Contraseñas requeridas' });
  }

  try {
    const result = await passwordManager.changePassword(oldPassword, newPassword);

    if (result.success) {
      currentPassword = newPassword;
      res.json({ success: true, message: result.message });
    } else {
      res.status(400).json({ success: false, message: result.message });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 0.5. Bloquear baúl manualmente
app.post('/api/vault/lock', async (req, res) => {
  if (!isAuthenticated || !currentPassword) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  try {
    const result = await portfolioVault.lockVault(currentPassword);

    if (result.success) {
      res.json({
        success: true,
        message: 'Baúl bloqueado correctamente',
        filesEncrypted: result.filesEncrypted,
        errors: result.errors
      });
    } else {
      res.status(400).json({ success: false, errors: result.errors });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 0.6. Obtener estadísticas del baúl
app.get('/api/vault/stats', async (req, res) => {
  try {
    const stats = await portfolioVault.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 0.7. Inicializar contraseña predeterminada (solo desarrollo)
app.post('/api/auth/init-default', async (req, res) => {
  try {
    const result = await passwordManager.initializeDefaultPassword();
    res.json({
      success: true,
      initialized: result.initialized,
      isDefault: result.isDefault,
      defaultPassword: result.initialized ? DEFAULT_PASSWORD : null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// === ENDPOINTS EXISTENTES ===

// 1. Obtener lista de alumnos
app.get('/api/students', (req, res) => {
  db.all('SELECT * FROM students WHERE isActive = 1', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// 2. Añadir nuevo alumno
app.post('/api/students', (req, res) => {
  const { name } = req.body;
  if (!name) {
    res.status(400).json({ error: 'El nombre es requerido' });
    return;
  }

  db.run('INSERT INTO students (name) VALUES (?)', [name], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ id: this.lastID, name, message: 'Alumno añadido' });
  });
});

// 3. Eliminar (inactivar) un alumno
app.delete('/api/students/:id', (req, res) => {
  const { id } = req.params;
  console.log(`[DELETE /api/students/${id}] Recibida solicitud para inactivar alumno ID: ${id}`);

  db.run('UPDATE students SET isActive = 0 WHERE id = ?', [id], function (err) {
    if (err) {
      console.error(`[DELETE /api/students/${id}] Error en la base de datos: ${err.message}`);
      res.status(500).json({ error: err.message });
      return;
    }
    console.log(`[DELETE /api/students/${id}] Cambios realizados: ${this.changes}`);
    if (this.changes === 0) {
      res.status(404).json({ message: 'Alumno no encontrado o ya inactivo' });
      return;
    }

    // Eliminación en cascada manual: Borrar perfil facial
    faceDb.deleteFaceProfile(id)
      .then(() => {
        console.log(`[DELETE /api/students/${id}] Perfil facial eliminado`);
        res.json({ message: 'Alumno inactivado y datos faciales eliminados', id });
      })
      .catch(err => {
        console.error(`Error borrando perfil facial: ${err.message}`);
        // No fallamos la request principal, pero avisamos
        res.json({ message: 'Alumno inactivado (error borrando datos faciales)', id });
      });
  });
});

// 4. Guardar captura
app.post('/api/captures', (req, res) => {
  const { studentId, subject, imageData, method, confidence, isClassified } = req.body;

  if (!studentId || !subject || !imageData) {
    res.status(400).json({ error: 'Datos incompletos' });
    return;
  }

  // Obtener datos del alumno y asignatura
  db.get('SELECT name, course_id FROM students WHERE id = ?', [studentId], (err, student) => {
    if (err || !student) {
      res.status(500).json({ error: 'Alumno no encontrado' });
      return;
    }

    // Buscar el ID de la asignatura
    db.get('SELECT id FROM subjects WHERE name = ?', [subject], (err, subjectRow) => {
      if (err || !subjectRow) {
        res.status(500).json({ error: 'Asignatura no encontrada' });
        return;
      }

      const subjectId = subjectRow.id;

      // Crear directorio de evidencias si no existe
      const evidencesDir = path.join(PORTFOLIOS_DIR, 'evidences');
      if (!fs.existsSync(evidencesDir)) {
        fs.mkdirSync(evidencesDir, { recursive: true });
      }

      // Generar nombre de archivo con formato móvil: [SUBJECT-ID]_[STUDENT-NAME]_[TIMESTAMP].jpg
      const subjectPrefix = generateSubjectId(subject);
      const studentName = normalizeStudentName(student.name);
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
      const filename = `${subjectPrefix}_${studentName}_${timestamp}.jpg`;
      const filepath = path.join(evidencesDir, filename);

      // Guardar imagen (base64 → binary)
      const imageBuffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      fs.writeFile(filepath, imageBuffer, (err) => {
        if (err) {
          res.status(500).json({ error: 'Error guardando imagen' });
          return;
        }

        // Guardar metadatos en tabla evidences
        const relativePath = `evidences/${filename}`;
        const captureDate = new Date().toISOString();

        db.run(
          `INSERT INTO evidences (
            student_id, course_id, subject_id, type, file_path, 
            capture_date, confidence, method, is_reviewed, created_at, file_size
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            studentId,
            student.course_id,
            subjectId,
            'IMG',
            relativePath,
            captureDate,
            confidence || 0,
            method || 'manual',
            isClassified ? 1 : 0,
            captureDate,
            imageBuffer.length
          ],
          function (err) {
            if (err) {
              res.status(500).json({ error: err.message });
              return;
            }
            res.json({
              id: this.lastID,
              filename,
              subject,
              message: 'Imagen guardada correctamente'
            });
          }
        );
      });
    });
  });
});

// 4. Obtener evidencias de un alumno (compatible con frontend antiguo)
app.get('/api/captures/:studentId', (req, res) => {
  const { studentId } = req.params;

  // Query con JOIN para obtener el nombre de la asignatura
  db.all(
    `SELECT 
      e.id,
      e.student_id as studentId,
      s.name as subject,
      e.file_path as imagePath,
      e.capture_date as timestamp,
      e.confidence,
      e.method,
      e.is_reviewed as isClassified
    FROM evidences e
    LEFT JOIN subjects s ON e.subject_id = s.id
    WHERE e.student_id = ?
    ORDER BY e.capture_date DESC`,
    [studentId],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// 5. Activar Modo Sesión (15 minutos)
app.post('/api/session/start', (req, res) => {
  const { subject } = req.body;

  if (!subject) {
    res.status(400).json({ error: 'Asignatura requerida' });
    return;
  }

  db.run(
    'INSERT INTO sessions (subject, duration, isActive) VALUES (?, 900, 1)',
    [subject],
    function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      res.json({
        id: this.lastID,
        subject,
        durationSeconds: 900,
        message: 'Modo Sesión activado por 15 minutos'
      });
    }
  );
});

// 6. Obtener Modo Sesión activo
app.get('/api/session/active', (req, res) => {
  db.get(
    'SELECT * FROM sessions WHERE isActive = 1 ORDER BY startTime DESC LIMIT 1',
    (err, row) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(row || null);
    }
  );
});

// 7. Desactivar Modo Sesión
app.post('/api/session/stop', (req, res) => {
  db.run('UPDATE sessions SET isActive = 0 WHERE isActive = 1', function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ message: 'Modo Sesión desactivado' });
  });
});

// ==================== ENDPOINTS DE RECONOCIMIENTO FACIAL ====================

// 8. Guardar descriptor facial de un estudiante (entrenamiento)
// 8. Guardar descriptor facial de un estudiante (entrenamiento)
app.post('/api/faces/train', (req, res) => {
  const { studentId, descriptor, confidence } = req.body;

  if (!studentId || !descriptor || descriptor.length !== 128) {
    res.status(400).json({ error: 'Datos de rostro inválidos' });
    return;
  }

  faceDb.saveFaceProfile(studentId, descriptor)
    .then(result => {
      res.json({
        ...result,
        message: 'Descriptor facial guardado y promediado'
      });
    })
    .catch(error => {
      res.status(500).json({ error: error.message });
    });
});

// 9. Buscar estudiante por descriptor facial
app.post('/api/faces/search', (req, res) => {
  const { descriptor } = req.body;

  if (!descriptor || descriptor.length !== 128) {
    res.status(400).json({ error: 'Descriptor inválido' });
    return;
  }

  faceDb.findMatchingStudent(descriptor, 0.6)
    .then(match => {
      if (match) {
        // Obtener nombre del estudiante
        db.get('SELECT name FROM students WHERE id = ?', [match.studentId], (err, row) => {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          res.json({
            studentId: match.studentId,
            name: row?.name || 'Desconocido',
            confidence: match.confidence,
            distance: match.distance
          });
        });
      } else {
        res.json({ studentId: null, confidence: 0 });
      }
    })
    .catch(error => {
      res.status(500).json({ error: error.message });
    });
});

// 10. Obtener información del perfil facial de un estudiante
app.get('/api/faces/:studentId', (req, res) => {
  const { studentId } = req.params;

  faceDb.getFaceProfileInfo(studentId)
    .then(info => {
      if (info) {
        res.json({ ...info, hasProfile: true });
      } else {
        res.json({ studentId, hasProfile: false, descriptorCount: 0 });
      }
    })
    .catch(error => {
      res.status(500).json({ error: error.message });
    });
});

// 11. Resetear perfil facial
app.delete('/api/faces/:studentId', (req, res) => {
  const { studentId } = req.params;

  faceDb.resetFaceProfile(studentId)
    .then(result => {
      res.json({ message: 'Perfil facial reseteado correctamente', changes: result.changes });
    })
    .catch(error => {
      res.status(500).json({ error: error.message });
    });
});

// ==================== ENDPOINTS DE MANTENIMIENTO DEL SISTEMA ====================

// 12. Resetear base de datos y archivos
app.post('/api/system/reset', (req, res) => {
  const { mode } = req.body; // mode: 'photos' o 'students'

  if (mode === 'photos') {
    // BORRAR SOLO FOTOS: Limpia tabla captures y archivos físicos
    db.run('DELETE FROM captures', (err) => {
      if (err) return res.status(500).json({ error: 'Error limpiando capturas' });

      if (err) return res.status(500).json({ error: 'Error limpiando capturas' });

      try {
        const folders = fs.readdirSync(PORTFOLIOS_DIR);
        for (const folder of folders) {
          if (folder === '.gitkeep' || folder === '_temporal_') continue;
          const fullPath = path.join(PORTFOLIOS_DIR, folder);
          if (fs.lstatSync(fullPath).isDirectory()) {
            // Borramos el contenido de las carpetas de alumnos (las asignaturas)
            // pero mantenemos la carpeta del alumno si queremos, o la borramos también.
            // Para "borrar solo fotos" manteniendo alumnos, borramos el contenido de la carpeta del alumno.
            fs.rmSync(fullPath, { recursive: true, force: true });
            fs.mkdirSync(fullPath); // Recreamos la carpeta vacía
          }
        }
        res.json({ message: 'Fotos y registros de captura borrados' });
      } catch (e) {
        res.status(500).json({ error: 'Error borrando archivos físicos' });
      }
    });
  } else if (mode === 'students') {
    // BORRAR SOLO ALUMNOS: Limpia tablas students y face_profiles, mantiene archivos
    db.serialize(() => {
      db.run('DELETE FROM face_profiles');
      db.run('DELETE FROM students', (err) => {
        if (err) return res.status(500).json({ error: 'Error limpiando alumnos' });
        res.json({ message: 'Alumnos y datos faciales borrados. Archivos conservados.' });
      });
    });
  } else {
    res.status(400).json({ error: 'Modo de reset no válido' });
  }
});

// 13. Sincronizar carpetas con base de datos
app.post('/api/system/sync', async (req, res) => {
  if (!fs.existsSync(PORTFOLIOS_DIR)) {
    res.status(404).json({ error: 'Carpeta portfolios no encontrada' });
    return;
  }

  try {
    const studentFolders = fs.readdirSync(PORTFOLIOS_DIR).filter(f => {
      const fullPath = path.join(PORTFOLIOS_DIR, f);
      return fs.lstatSync(fullPath).isDirectory() && f !== '_temporal_';
    });

    let studentsCreated = 0;
    let capturesCreated = 0;

    for (const folder of studentFolders) {
      // Intentar extraer ID: "Nombre_Apellido_ID" o "student_ID"
      const parts = folder.split('_');
      let studentId = parseInt(parts[parts.length - 1]);
      let studentName = parts.slice(0, -1).join(' ') || folder;

      // Si no hay ID al final, creamos el alumno y renombramos la carpeta
      if (isNaN(studentId)) {
        studentName = folder.replace(/_/g, ' '); // Si era "Diego_Perez" lo convertimos a "Diego Perez"
        await new Promise((resolve) => {
          db.run('INSERT INTO students (name) VALUES (?)', [studentName], function (err) {
            if (!err) {
              const newId = this.lastID;
              const newFolderName = getStudentFolderName(newId, studentName);
              try {
                fs.renameSync(path.join(PORTFOLIOS_DIR, folder), path.join(PORTFOLIOS_DIR, newFolderName));
                console.log(`🔄 Sincronizado y renombrado: ${folder} -> ${newFolderName}`);
                studentsCreated++;
                // Actualizamos variables para procesar capturas después
                folderToProcess = newFolderName;
                studentId = newId;
              } catch (e) {
                console.error('Error renombrando carpeta en sync:', e);
              }
            }
            resolve();
          });
        });
      } else {
        // El formato ya es Nombre_ID, asegurar que existe en BD
        await new Promise((resolve) => {
          db.get('SELECT id FROM students WHERE id = ?', [studentId], (err, row) => {
            if (!row) {
              db.run('INSERT INTO students (id, name) VALUES (?, ?)', [studentId, studentName], () => {
                studentsCreated++;
                resolve();
              });
            } else {
              resolve();
            }
          });
        });
      }

      // 2. Escanear asignaturas (usar el ID y nombre actualizados si se renombró)
      const currentFolder = isNaN(parseInt(parts[parts.length - 1])) ? getStudentFolderName(studentId, studentName) : folder;
      const studentPath = path.join(PORTFOLIOS_DIR, currentFolder);
      const subjects = fs.readdirSync(studentPath).filter(f =>
        fs.lstatSync(path.join(studentPath, f)).isDirectory()
      );

      for (const subject of subjects) {
        const subjectPath = path.join(studentPath, subject);
        const images = fs.readdirSync(subjectPath).filter(f => f.toLowerCase().endsWith('.jpg'));

        for (const img of images) {
          const relativePath = `${folder}/${subject}/${img}`;
          await new Promise((resolve) => {
            db.get('SELECT id FROM captures WHERE imagePath = ?', [relativePath], (err, row) => {
              if (!row) {
                db.run(
                  'INSERT INTO captures (studentId, subject, imagePath, isClassified) VALUES (?, ?, ?, 1)',
                  [studentId, subject, relativePath],
                  () => {
                    capturesCreated++;
                    resolve();
                  }
                );
              } else {
                resolve();
              }
            });
          });
        }
      }
    }

    res.json({ studentsCreated, capturesCreated, message: 'Sincronización completada' });
  } catch (error) {
    console.error('Error en sincronización:', error);
    res.status(500).json({ error: error.message });
  }
});

// 14. Listar archivos pendientes en _temporal_
app.get('/api/system/pending', (req, res) => {
  const tempPath = path.join(PORTFOLIOS_DIR, '_temporal_');
  if (!fs.existsSync(tempPath)) {
    fs.mkdirSync(tempPath, { recursive: true });
    res.json([]);
    return;
  }

  try {
    const files = fs.readdirSync(tempPath)
      .filter(f => f.toLowerCase().endsWith('.jpg'))
      .map(f => ({
        id: f,
        name: f,
        url: `/_temporal_/${f}` // Asumiendo que servimos portfolios como estáticos
      }));
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Asegurar que se sirva la carpeta portfolios como estática para poder ver las fotos de _temporal_
app.use('/_temporal_', express.static(path.join(PORTFOLIOS_DIR, '_temporal_')));

// 15. Mover archivo de _temporal_ a portfolio definitivo
app.post('/api/system/move', (req, res) => {
  const { filename, studentId, subject } = req.body;

  db.get('SELECT name FROM students WHERE id = ?', [studentId], (err, student) => {
    if (err || !student) return res.status(404).json({ error: 'Alumno no encontrado' });

    const studentFolderName = getStudentFolderName(studentId, student.name);
    const sourcePath = path.join(PORTFOLIOS_DIR, '_temporal_', filename);
    const destDir = path.join(PORTFOLIOS_DIR, studentFolderName, subject);
    const destPath = path.join(destDir, filename);

    if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: 'Archivo original no encontrado' });

    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    try {
      fs.renameSync(sourcePath, destPath);

      // Registrar en BD
      const relativePath = `${studentFolderName}/${subject}/${filename}`;
      db.run(
        'INSERT INTO captures (studentId, subject, imagePath, method, isClassified) VALUES (?, ?, ?, ?, ?)',
        [studentId, subject, relativePath, 'imported', 1],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: 'Archivo movido y registrado', id: this.lastID });
        }
      );
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// 16. Guardar captura temporal (Modo Rápido)
app.post('/api/system/temp-capture', (req, res) => {
  const { subject, imageData } = req.body;

  if (!subject || !imageData) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  const tempPath = path.join(PORTFOLIOS_DIR, '_temporal_');
  if (!fs.existsSync(tempPath)) fs.mkdirSync(tempPath, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  // Prefijamos la asignatura para que el asistente de clasificación la detecte luego
  const filename = `${subject}_${timestamp}.jpg`;
  const filepath = path.join(tempPath, filename);

  const imageBuffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');

  fs.writeFile(filepath, imageBuffer, (err) => {
    if (err) return res.status(500).json({ error: 'Error guardando imagen temporal' });
    res.json({ message: 'Imagen guardada en temporal', filename });
  });
});

// === INICIALIZACIÓN Y ARRANQUE DEL SERVIDOR ===

/**
 * Inicializa el sistema de encriptación al arrancar el servidor
 */
async function initializeEncryptionSystem() {
  console.log('\n🔐 Inicializando sistema de encriptación...');

  // 1. Verificar si existe contraseña configurada
  const hasPassword = await passwordManager.hasPassword();

  if (!hasPassword) {
    // Configurar contraseña predeterminada
    console.log('⚠️  No hay contraseña configurada. Usando contraseña predeterminada.');
    await passwordManager.initializeDefaultPassword();
    console.log(`✅ Contraseña predeterminada configurada: "${DEFAULT_PASSWORD}"`);
    console.log('⚠️  IMPORTANTE: Cambia la contraseña predeterminada en producción.');
  } else {
    console.log('✅ Contraseña del maestro ya configurada.');
  }

  // 2. Verificar estado del baúl
  const vaultLocked = await portfolioVault.isLocked();
  const stats = await portfolioVault.getStats();

  if (vaultLocked) {
    console.log('🔒 Baúl de portfolios BLOQUEADO.');
    console.log(`   📊 Archivos encriptados: ${stats.encryptedFiles}`);
    console.log('   ⚠️  Inicia sesión para desbloquear el baúl.');
  } else {
    console.log('🔓 Baúl de portfolios DESBLOQUEADO.');
    console.log(`   📊 Total de archivos: ${stats.totalFiles}`);

    if (stats.encryptedFiles > 0) {
      console.log(`   ⚠️  Advertencia: ${stats.encryptedFiles} archivos aún encriptados.`);
    }
  }

  console.log('');
}

let isShuttingDown = false;

/**
 * Maneja el cierre graceful del servidor
 */
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n\n⚠️  Señal ${signal} recibida. Cerrando servidor...`);

  // Si hay una sesión autenticada, bloquear el baúl
  if (isAuthenticated && currentPassword) {
    console.log('🔒 Bloqueando baúl de portfolios antes de cerrar...');

    try {
      const result = await portfolioVault.lockVault(currentPassword);
      if (result.success) {
        console.log(`✅ Baúl bloqueado. ${result.filesEncrypted} archivos encriptados.`);
      } else {
        console.error('❌ Error bloqueando baúl:', result.errors);
      }
    } catch (error) {
      console.error('❌ Error en cierre graceful:', error.message);
    }
  }

  // Cerrar base de datos
  db.close((err) => {
    if (err) {
      console.error('Error cerrando base de datos:', err);
    } else {
      console.log('✅ Base de datos cerrada correctamente.');
    }

    console.log('👋 Servidor cerrado. ¡Hasta pronto!\n');
    process.exit(0);
  });
}

// ==================== API DE SINCRONIZACIÓN (MÓVIL <-> ESCRITORIO) ====================

// 1. Obtener metadatos completos (PULL desde móvil)
app.get('/api/sync/metadata', (req, res) => {
  const metadata = {
    students: [],
    courses: [],
    subjects: [],
    evidences: []
  };

  db.serialize(() => {
    db.all('SELECT * FROM courses', (err, rows) => {
      if (!err) metadata.courses = rows;
    });

    db.all('SELECT * FROM subjects', (err, rows) => {
      if (!err) metadata.subjects = rows;
    });

    db.all('SELECT * FROM students', (err, rows) => {
      if (!err) metadata.students = rows;
    });

    db.all('SELECT * FROM evidences', (err, rows) => {
      if (!err) metadata.evidences = rows;
      // Enviar respuesta cuando termine la última consulta
      res.json(metadata);
    });
  });
});

// 2. Recibir datos nuevos (PUSH desde móvil)
app.post('/api/sync/push', (req, res) => {
  const { students, evidences } = req.body;
  const results = { students: 0, evidences: 0, errors: [] };

  db.serialize(() => {
    // Procesar estudiantes
    if (students && students.length > 0) {
      // Usamos REPLACE para actualizar si ya existe (especialmente para añadir embeddings)
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO students (id, name, course_id, enrollmentDate, isActive, face_embeddings_192)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      students.forEach(s => {
        // Convertir array de embeddings a Buffer si viene como array
        let embeddingsBuffer = null;
        if (s.face_embeddings_192) {
          if (Array.isArray(s.face_embeddings_192)) {
            embeddingsBuffer = Buffer.from(s.face_embeddings_192);
          } else if (s.face_embeddings_192.type === 'Buffer') {
            embeddingsBuffer = Buffer.from(s.face_embeddings_192.data);
          } else {
            embeddingsBuffer = s.face_embeddings_192;
          }
        }

        stmt.run([
          s.id,
          s.name,
          s.courseId,
          s.enrollmentDate,
          s.isActive ? 1 : 0,
          embeddingsBuffer
        ], function (err) {
          if (err) results.errors.push(`Error sync student ${s.id}: ${err.message}`);
          else results.students++;
        });
      });
      stmt.finalize();
    }

    // Procesar evidencias (metadatos)
    if (evidences && evidences.length > 0) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO evidences (
          id, student_id, course_id, subject_id, type, file_path, 
          capture_date, confidence, method, is_reviewed, file_size
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      evidences.forEach(e => {
        stmt.run([
          e.id, e.studentId, e.courseId, e.subjectId, e.type, e.filePath,
          e.captureDate, e.confidence, e.method, e.isReviewed ? 1 : 0, e.fileSize
        ], function (err) {
          if (err) results.errors.push(`Error sync evidence ${e.id}: ${err.message}`);
          else if (this.changes > 0) results.evidences++;
        });
      });
      stmt.finalize(() => {
        res.json({ success: true, results });
      });
    } else {
      res.json({ success: true, results });
    }
  });
});

// 3. Subir archivo de evidencia (desde móvil)
app.post('/api/sync/files', (req, res) => {
  // Nota: En una implementación real usaríamos middleware como 'multer' para multipart/form-data
  // Aquí asumimos envío raw body o base64 para simplificar, similar a /api/captures

  const { filename, fileData } = req.body;
  if (!filename || !fileData) {
    return res.status(400).json({ error: 'Filename and fileData required' });
  }

  // Verificar si el baúl está bloqueado
  portfolioVault.isLocked().then(locked => {
    // Si está bloqueado, NO permitimos guardar archivos porque no podemos encriptarlos correctamente
    // sin la contraseña del usuario (que no queremos transmitir por la red)
    /*
    if (locked) {
      return res.status(403).json({ error: 'Vault is locked. Unlock desktop app to sync files.' });
    }
    */
    // REVISIÓN: En realidad, si el baúl está bloqueado, podríamos guardar los archivos ENCRIPTADOS
    // si tuviéramos la clave pública o similar, pero aquí la encriptación es simétrica.
    // Opción segura: Solo permitir sync si el baúl está desbloqueado.

    if (locked) {
      return res.status(503).json({
        error: 'El baúl está bloqueado. Desbloquea la aplicación de escritorio para sincronizar archivos.'
      });
    }

    const evidencesDir = path.join(PORTFOLIOS_DIR, 'evidences');
    if (!fs.existsSync(evidencesDir)) {
      fs.mkdirSync(evidencesDir, { recursive: true });
    }

    const filepath = path.join(evidencesDir, filename);
    const buffer = Buffer.from(fileData, 'base64');

    fs.writeFile(filepath, buffer, (err) => {
      if (err) {
        res.status(500).json({ error: 'Error saving file' });
      } else {
        res.json({ success: true, filename });
      }
    });
  });
});

// 4. Descargar archivo de evidencia (hacia móvil)
app.get('/api/sync/files/:filename', (req, res) => {
  const { filename } = req.params;

  // Buscar en carpetas planas (nuevo sistema)
  let filepath = path.join(PORTFOLIOS_DIR, 'evidences', filename);

  if (!fs.existsSync(filepath)) {
    // Intentar buscar en estructura antigua (fallback)
    // Esto es complicado porque requeriría consultar la BD para saber la ruta antigua...
    // Por simplicidad, asumimos que todo se mueve a evidences/ o la BD tiene la ruta correcta relativa

    // Consultar BD para ver si es una ruta relativa antigua
    db.get('SELECT file_path FROM evidences WHERE file_path LIKE ?', [`%${filename}`], (err, row) => {
      if (err || !row) {
        return res.status(404).json({ error: 'File not found' });
      }

      // Construir ruta completa basada en lo que hay en BD
      filepath = path.join(PORTFOLIOS_DIR, row.file_path);

      serveFile(res, filepath);
    });
  } else {
    serveFile(res, filepath);
  }
});

/**
 * Obtiene la dirección IP local del equipo en la red.
 * @returns {string}
 */
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Filtrar IPv4 y que no sea loopback (127.0.0.1)
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// 5. Obtener información del sistema (IP y puerto para sincronización)
app.get('/api/system/info', (req, res) => {
  res.json({
    ip: getLocalIpAddress(),
    port: PORT,
    status: 'online'
  });
});


function serveFile(res, filepath) {
  // Verificar si el archivo existe
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'File on disk not found' });
  }

  // Verificar si está encriptado
  // (Nota: fs.existsSync(filepath) daría false si solo existe .enc, así que hay que comprobar ambos)

  // Si pedimos archivo.jpg y existe archivo.jpg.enc
  if (!fs.existsSync(filepath) && fs.existsSync(filepath + '.enc')) {
    return res.status(503).json({ error: 'File is encrypted. Unlock vault first.' });
  }

  res.sendFile(filepath);
}


// Capturar señales de cierre
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Iniciar servidor
app.listen(PORT, async () => {
  console.log(`\n🚀 Servidor web EduPortfolio escuchando en http://localhost:${PORT}`);
  console.log(`📁 Carpeta de portfolios: ${PORTFOLIOS_DIR}`);
  console.log(`📊 Base de datos: ${dbPath}`);

  // Inicializar sistema de encriptación
  await initializeEncryptionSystem();
});
