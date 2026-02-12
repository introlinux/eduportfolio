const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const faceDbModule = null; // Se cargará después de asegurar las carpetas

// === SISTEMA DE ENCRIPTACIÓN ===
const { PasswordManager, DEFAULT_PASSWORD } = require('./password-manager');
const { PortfolioVault } = require('./portfolio-vault');
const { DecryptionCache } = require('./decryption-cache');

const app = express();
const PORT = process.env.PORT || 3000;
const USER_DATA_PATH = process.env.USER_DATA_PATH;

// Configurar multer para subida de archivos
const upload = multer({
  storage: multer.memoryStorage(), // Guardar en memoria temporalmente
  limits: {
    fileSize: 50 * 1024 * 1024, // Límite de 50MB
  },
});

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
const decryptionCache = new DecryptionCache(150, 30 * 60 * 1000); // 150 imágenes, 30 min TTL

// Variable global para almacenar la contraseña actual (solo en memoria)
let currentPassword = null;
let isAuthenticated = false;

// Ahora cargamos el módulo de base de datos de rostros una vez las carpetas existen
const faceDb = require('./faceDatabase');

/**
 * Normaliza un nombre para comparaciones flexibles (sin acentos y en minúsculas)
 * @param {string} name 
 * @returns {string}
 */
function normalizeNameForComparison(name) {
  if (!name) return '';
  return removeAccents(name).toLowerCase().trim();
}

// 1. Configuración básica y middlewares
app.use(cors()); // Keep cors as it was not explicitly removed
app.use(express.json({ limit: '50mb' })); // Replaces bodyParser.json
app.use(express.urlencoded({ limit: '50mb', extended: true })); // Add express.urlencoded to replace bodyParser.urlencoded
app.use(express.static(PUBLIC_DIR));
app.use('/_temporal_', express.static(path.join(PORTFOLIOS_DIR, '_temporal_')));

// === MIDDLEWARE DE DESENCRIPTACIÓN ON-DEMAND ===
// Intercepta solicitudes de imágenes en /portfolios y las desencripta en memoria
app.use('/portfolios', async (req, res, next) => {
  // Solo procesar archivos de imagen (incluyendo archivos .enc)
  const isImage = /\.(jpg|jpeg|png|webp|gif)(\.enc)?$/i.test(req.path);
  if (!isImage) {
    return next(); // Dejar pasar otros archivos
  }

  // Verificar autenticación
  if (!isAuthenticated || !currentPassword) {
    return res.status(401).json({ error: 'No autenticado. Inicia sesión primero.' });
  }

  try {
    // Construir ruta absoluta del archivo (sin .enc si lo tiene)
    const cleanPath = req.path.replace(/\.enc$/i, '');
    const filePath = path.join(PORTFOLIOS_DIR, cleanPath);

    // Obtener imagen desencriptada del cache (o desencriptarla si no está)
    const imageBuffer = await decryptionCache.get(filePath, currentPassword);

    // Determinar tipo MIME basado en la extensión original (sin .enc)
    const ext = path.extname(cleanPath).toLowerCase();
    let mimeType = 'image/jpeg'; // Default
    if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.webp') mimeType = 'image/webp';
    else if (ext === '.gif') mimeType = 'image/gif';

    // Servir imagen desde memoria
    res.set('Content-Type', mimeType);
    res.set('Cache-Control', 'private, max-age=3600'); // Cache del navegador por 1 hora
    res.send(imageBuffer);
  } catch (error) {
    console.error(`❌ Error sirviendo imagen ${req.path}:`, error.message);

    // Si el archivo no existe o no se puede desencriptar, devolver 404
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Imagen no encontrada' });
    }

    res.status(500).json({ error: 'Error desencriptando imagen' });
  }
});

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
    db.all("SELECT name FROM subjects", (err, existingSubjects) => {
      if (!err) {
        const existingNames = existingSubjects.map(s => s.name);
        const defaultSubjects = [
          { name: 'Matemáticas', icon: '🧮', color: '#2196F3' },
          { name: 'Lengua', icon: '📚', color: '#4CAF50' },
          { name: 'Ciencias', icon: '🧪', color: '#FF9800' },
          { name: 'Inglés', icon: '🇬🇧', color: '#F44336' },
          { name: 'Artística', icon: '🎨', color: '#9C27B0' }
        ];

        // Solo crear las que faltan
        const missingSubjects = defaultSubjects.filter(s => !existingNames.includes(s.name));

        if (missingSubjects.length > 0) {
          const stmt = db.prepare("INSERT INTO subjects (name, icon, color, is_default) VALUES (?, ?, ?, 1)");
          missingSubjects.forEach(s => {
            stmt.run(s.name, s.icon, s.color, (err) => {
              if (err) {
                console.error(`❌ Error creando asignatura ${s.name}:`, err.message);
              } else {
                console.log(`✅ Asignatura creada: ${s.name}`);
              }
            });
          });
          stmt.finalize(() => {
            console.log('✅ Proceso de creación de asignaturas por defecto completado');
          });
        }
      }

      // Continuar con el parche de iconos/colores
      if (!err) {
        // Parche para asignar iconos/colores a registros existentes que no los tengan
        const patches = [
          { name: 'Matemáticas', icon: '🧮', color: '#2196F3' },
          { name: 'Lengua', icon: '📚', color: '#4CAF50' },
          { name: 'Ciencias', icon: '🧪', color: '#FF9800' },
          { name: 'Inglés', icon: '🇬🇧', color: '#F44336' },
          { name: 'Artística', icon: '🎨', color: '#9C27B0' }
        ];

        patches.forEach(p => {
          db.run(
            "UPDATE subjects SET icon = ?, color = ? WHERE name = ? AND (icon IS NULL OR icon = '' OR color IS NULL OR color = '')",
            [p.icon, p.color, p.name]
          );
        });
      }
    });

    // Migración 2: Crear curso por defecto si no existe
    db.get("SELECT COUNT(*) as count FROM courses", (err, row) => {
      if (!err && row.count === 0) {
        const now = new Date();
        const currentYear = now.getFullYear();
        const nextYear = currentYear + 1;
        // Formato corto según calendario español
        const courseName = now.getMonth() >= 8
          ? `Curso ${currentYear}-${nextYear.toString().substring(2)}`
          : `Curso ${currentYear - 1}-${currentYear.toString().substring(2)}`;
        db.run(
          "INSERT INTO courses (name, start_date, is_active) VALUES (?, ?, 1)",
          [courseName, now.toISOString()],
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

    // Migración 6: Añadir columnas de timestamp a students (unificación con móvil)
    db.all("PRAGMA table_info(students)", (err, columns) => {
      if (!err) {
        const hasCreatedAt = columns.some(col => col.name === 'created_at');
        const hasUpdatedAt = columns.some(col => col.name === 'updated_at');

        // Crear created_at primero, luego updated_at secuencialmente
        const addUpdatedAt = () => {
          if (!hasUpdatedAt) {
            db.run("ALTER TABLE students ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP", (err) => {
              if (!err) {
                console.log('✅ Columna updated_at añadida a students');
                // Backfill con created_at (que ya existe) o CURRENT_TIMESTAMP
                db.run("UPDATE students SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
              }
            });
          }
        };

        if (!hasCreatedAt) {
          db.run("ALTER TABLE students ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP", (err) => {
            if (!err) {
              console.log('✅ Columna created_at añadida a students');
              // Backfill con enrollmentDate si existe, sino CURRENT_TIMESTAMP
              db.run("UPDATE students SET created_at = COALESCE(enrollmentDate, CURRENT_TIMESTAMP) WHERE created_at IS NULL", (err) => {
                // Después de crear y rellenar created_at, crear updated_at
                if (!err) addUpdatedAt();
              });
            }
          });
        } else {
          // Si created_at ya existe, crear updated_at directamente
          addUpdatedAt();
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

      // ⚠️ NUEVO: Ya NO desencriptamos todo al iniciar sesión
      // Las imágenes se desencriptan on-demand en memoria cuando se solicitan

      console.log('✅ Usuario autenticado. Imágenes se desencriptarán on-demand.');

      res.json({
        success: true,
        message: 'Autenticación exitosa',
        vaultUnlocked: true, // Para compatibilidad con frontend
        filesDecrypted: 0 // Ya no desencriptamos todo
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

// 0.6. Obtener estadísticas del baúl y cache
app.get('/api/vault/stats', async (req, res) => {
  try {
    const vaultStats = await portfolioVault.getStats();
    const cacheStats = decryptionCache.getStats();

    res.json({
      ...vaultStats,
      cache: cacheStats
    });
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

// 1. Obtener lista de alumnos con estado de perfil facial
app.get('/api/students', (req, res) => {
  const query = `
    SELECT s.*, fp.descriptorCount 
    FROM students s
    LEFT JOIN face_profiles fp ON s.id = fp.studentId
    WHERE s.isActive = 1
    ORDER BY s.name ASC
  `;

  db.all(query, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// 2. Añadir nuevo alumno (o reactivar si ya existía pero estaba inactivo)
app.post('/api/students', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    res.status(400).json({ error: 'El nombre es requerido' });
    return;
  }

  try {
    // Obtener curso activo por defecto
    const activeCourseId = await getOrCreateActiveCourse();

    // Intentar insertar. Si falla por nombre único, intentar reactivar si estaba inactivo.
    db.run('INSERT INTO students (name, course_id) VALUES (?, ?)', [name, activeCourseId], function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          // Alumno ya existe, verificar si está inactivo para reactivarlo
          db.run('UPDATE students SET isActive = 1, course_id = ? WHERE name = ?', [activeCourseId, name], function (updateErr) {
            if (updateErr) {
              res.status(500).json({ error: updateErr.message });
            } else if (this.changes > 0) {
              res.json({ message: 'Alumno reactivado', name });
            } else {
              res.status(400).json({ error: 'El alumno ya existe y está activo' });
            }
          });
          return;
        }
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ id: this.lastID, name, courseId: activeCourseId, message: 'Alumno añadido' });
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener curso activo: ' + error.message });
  }
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
  const { studentId, subject, subject_id, imageData, method, confidence, isClassified } = req.body;

  if (!studentId || (!subject && !subject_id) || !imageData) {
    res.status(400).json({ error: 'Datos incompletos' });
    return;
  }

  // Obtener datos del alumno
  db.get('SELECT name, course_id FROM students WHERE id = ?', [studentId], (err, student) => {
    if (err || !student) {
      res.status(500).json({ error: 'Alumno no encontrado' });
      return;
    }

    // Buscar o usar el ID de la asignatura
    const getSubjectId = new Promise((resolve, reject) => {
      if (subject_id) {
        // Verificar que el ID existe
        db.get('SELECT id, name FROM subjects WHERE id = ?', [subject_id], (err, row) => {
          if (err || !row) {
            // Fallback: usar la primera asignatura disponible
            db.get('SELECT id, name FROM subjects ORDER BY id ASC LIMIT 1', (err, fallbackRow) => {
              if (err || !fallbackRow) reject(new Error('No hay asignaturas configuradas'));
              else resolve(fallbackRow);
            });
          } else {
            resolve(row);
          }
        });
      } else if (subject) {
        // Fallback al nombre (compatibilidad antigua)
        db.get('SELECT id, name FROM subjects WHERE name = ?', [subject], (err, row) => {
          if (err || !row) {
            // Fallback: usar la primera asignatura disponible
            db.get('SELECT id, name FROM subjects ORDER BY id ASC LIMIT 1', (err, fallbackRow) => {
              if (err || !fallbackRow) reject(new Error('No hay asignaturas configuradas'));
              else resolve(fallbackRow);
            });
          } else {
            resolve(row);
          }
        });
      } else {
        // Si no hay nada, usar la primera disponible
        db.get('SELECT id, name FROM subjects ORDER BY id ASC LIMIT 1', (err, fallbackRow) => {
          if (err || !fallbackRow) reject(new Error('No hay asignaturas configuradas'));
          else resolve(fallbackRow);
        });
      }
    });

    getSubjectId.then(subjectRow => {
      const finalSubjectId = subjectRow.id;
      const finalSubjectName = subjectRow.name;

      // Crear directorio de evidencias si no existe
      const evidencesDir = path.join(PORTFOLIOS_DIR, 'evidences');
      if (!fs.existsSync(evidencesDir)) {
        fs.mkdirSync(evidencesDir, { recursive: true });
      }

      // Generar nombre de archivo con formato móvil: [SUBJECT-ID]_[STUDENT-NAME]_[TIMESTAMP].jpg
      const subjectPrefix = generateSubjectId(finalSubjectName);
      const studentName = normalizeStudentName(student.name);
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
      const filename = `${subjectPrefix}_${studentName}_${timestamp}.jpg`;
      const filepath = path.join(evidencesDir, filename);

      // Guardar imagen (base64 → binary)
      const imageBuffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      fs.writeFile(filepath, imageBuffer, async (err) => {
        if (err) {
          res.status(500).json({ error: 'Error guardando imagen' });
          return;
        }

        // ⚠️ NUEVO: Encriptar automáticamente la imagen si el usuario está autenticado
        let finalFilename = filename;
        if (isAuthenticated && currentPassword) {
          try {
            const cryptoManager = require('./crypto-manager');
            await cryptoManager.encryptFile(filepath, currentPassword);
            finalFilename = filename + cryptoManager.ENCRYPTED_EXTENSION;
            console.log(`🔒 Imagen encriptada automáticamente: ${filename}`);
          } catch (encryptError) {
            console.error('⚠️  Error encriptando imagen:', encryptError.message);
            // No fallar la operación completa si falla la encriptación
          }
        }

        // Guardar metadatos en tabla evidences
        const relativePath = `evidences/${finalFilename}`;
        const captureDate = new Date().toISOString();

        db.run(
          `INSERT INTO evidences (
            student_id, course_id, subject_id, type, file_path,
            capture_date, confidence, method, is_reviewed, created_at, file_size
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            studentId,
            student.course_id,
            finalSubjectId,
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
              filename: finalFilename,
              subject: finalSubjectName,
              message: 'Imagen guardada y encriptada correctamente'
            });
          }
        );
      });
    }).catch(error => {
      res.status(500).json({ error: error.message });
    });
  });
});

// 3.1. Obtener TODAS las evidencias (para la galería global)
app.get('/api/captures', (req, res) => {
  db.all(
    `SELECT 
      e.id,
      e.student_id as studentId,
      st.name as studentName,
      s.name as subject,
      e.file_path as imagePath,
      e.capture_date as timestamp,
      e.confidence,
      e.method,
      e.is_reviewed as isClassified
    FROM evidences e
    LEFT JOIN subjects s ON e.subject_id = s.id
    LEFT JOIN students st ON e.student_id = st.id
    ORDER BY e.capture_date DESC`,
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// 4. Obtener evidencias de un alumno
app.get('/api/captures/:studentId', (req, res) => {
  const { studentId } = req.params;

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

// 4.1. Eliminar evidencia individual
app.delete('/api/evidences/:id', (req, res) => {
  const { id } = req.params;

  // Primero obtener la ruta del archivo para borrarlo del disco
  db.get('SELECT file_path FROM evidences WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Evidencia no encontrada' });
    }

    const fullPath = path.join(PORTFOLIOS_DIR, row.file_path);

    // Borrar de la base de datos
    db.run('DELETE FROM evidences WHERE id = ?', [id], function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Intentar borrar el archivo físico (no fallar si no existe)
      if (fs.existsSync(fullPath)) {
        fs.unlink(fullPath, (err) => {
          if (err) console.error(`Error borrando archivo físico: ${fullPath}`, err);
          else console.log(`✅ Archivo borrado: ${fullPath}`);
        });
      }

      res.json({ success: true, message: 'Evidencia eliminada correctamente' });
    });
  });
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

// 9. Eliminar estudiante (baja lógica)
app.delete('/api/students/:id', (req, res) => {
  const { id } = req.params;
  db.run('UPDATE students SET isActive = 0 WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Estudiante dado de baja', changes: this.changes });
  });
});

// === GESTIÓN DE CURSOS ===

// 10. Listar cursos
app.get('/api/courses', (req, res) => {
  const { active } = req.query;
  let query = 'SELECT * FROM courses';
  const params = [];

  if (active !== undefined) {
    query += ' WHERE is_active = ?';
    params.push(active === 'true' ? 1 : 0);
  }

  query += ' ORDER BY start_date DESC';

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 11. Crear curso
app.post('/api/courses', (req, res) => {
  const { name, start_date } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre del curso requerido' });

  const startDate = start_date || new Date().toISOString();

  db.run(
    'INSERT INTO courses (name, start_date, is_active) VALUES (?, ?, 1)',
    [name, startDate],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, name, start_date: startDate, is_active: 1 });
    }
  );
});

// 12. Archivar curso
app.put('/api/courses/:id/archive', (req, res) => {
  const { id } = req.params;
  const endDate = new Date().toISOString();

  db.run(
    'UPDATE courses SET is_active = 0, end_date = ? WHERE id = ?',
    [endDate, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Curso archivado', changes: this.changes });
    }
  );
});

// 13. Reactivar curso
app.put('/api/courses/:id/reactivate', (req, res) => {
  const { id } = req.params;

  db.run(
    'UPDATE courses SET is_active = 1, end_date = NULL WHERE id = ?',
    [id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Curso reactivado', changes: this.changes });
    }
  );
});

// 14. Eliminar curso completamente (CASDADA)
app.delete('/api/courses/:id', (req, res) => {
  const { id } = req.params;

  // 1. Obtener todos los alumnos del curso
  db.all('SELECT id FROM students WHERE course_id = ?', [id], (err, students) => {
    if (err) return res.status(500).json({ error: err.message });

    const studentIds = students.map(s => s.id);
    if (studentIds.length === 0) {
      // Si no hay alumnos, borrar curso directamente
      deleteCourseRecord(id, res);
      return;
    }

    // 2. Obtener todas las evidencias de estos alumnos para borrar archivos físicos
    const placeholders = studentIds.map(() => '?').join(',');
    db.all(`SELECT file_path, thumbnail_path FROM evidences WHERE student_id IN (${placeholders})`, studentIds, (err, rows) => {
      if (err) console.error('Error obteniendo evidencias para borrar:', err);

      // Borrar archivos físicos
      if (rows && rows.length > 0) {
        rows.forEach(row => {
          try {
            // Intentar borrar archivo original
            const fullPath = path.join(PORTFOLIOS_DIR, row.file_path);
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

            // Intentar borrar thumbnail
            if (row.thumbnail_path) {
              const thumbPath = path.join(PORTFOLIOS_DIR, row.thumbnail_path);
              if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
            }
          } catch (e) {
            console.error('Error borrando archivo físico:', e.message);
          }
        });
      }

      // 3. Borrar registros en BD (evidences, face_profiles, students)
      db.serialize(() => {
        // Borrar evidencias
        db.run(`DELETE FROM evidences WHERE student_id IN (${placeholders})`, studentIds);

        // Borrar perfiles faciales
        db.run(`DELETE FROM face_profiles WHERE studentId IN (${placeholders})`, studentIds);

        // Borrar logs de reconocimiento
        db.run(`DELETE FROM recognition_logs WHERE studentId IN (${placeholders})`, studentIds);

        // Borrar alumnos
        db.run(`DELETE FROM students WHERE course_id = ?`, [id], (err) => {
          if (err) return res.status(500).json({ error: err.message });

          // 4. Finalmente, borrar el curso
          deleteCourseRecord(id, res);
        });
      });
    });
  });
});

function deleteCourseRecord(id, res) {
  db.run('DELETE FROM courses WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Curso y todos sus datos eliminados correctamente', changes: this.changes });
  });
}

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

          // FIX: Verificar mensaje de "error al guardar la foto"
          // Si el alumno no existe en la BD (borrado pero con perfil facial huérfano),
          // devolver desconocido para evitar que el frontend intente guardar.
          if (!row) {
            console.warn(`⚠️ Perfil facial huérfano detectado para ID ${match.studentId}. Ignorando.`);
            res.json({ studentId: null, confidence: 0 });
            return;
          }

          res.json({
            studentId: match.studentId,
            name: row.name,
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

// === ENDPOINTS DE ASIGNATURAS ===

// 12. Obtener lista de asignaturas
app.get('/api/subjects', (req, res) => {
  db.all('SELECT * FROM subjects ORDER BY is_default DESC, name ASC', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// 13. Añadir nueva asignatura
app.post('/api/subjects', (req, res) => {
  const { name, color, icon, is_default } = req.body;
  if (!name) {
    res.status(400).json({ error: 'El nombre es requerido' });
    return;
  }

  db.run(
    'INSERT INTO subjects (name, color, icon, is_default) VALUES (?, ?, ?, ?)',
    [name, color, icon, is_default ? 1 : 0],
    function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ id: this.lastID, name, message: 'Asignatura añadida' });
    }
  );
});

// 14. Actualizar asignatura
app.put('/api/subjects/:id', (req, res) => {
  const { id } = req.params;
  const { name, color, icon, is_default } = req.body;

  db.run(
    'UPDATE subjects SET name = ?, color = ?, icon = ?, is_default = ? WHERE id = ?',
    [name, color, icon, is_default ? 1 : 0, id],
    function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        res.status(404).json({ error: 'Asignatura no encontrada' });
        return;
      }
      res.json({ message: 'Asignatura actualizada' });
    }
  );
});

// 15. Eliminar asignatura
app.delete('/api/subjects/:id', (req, res) => {
  const { id } = req.params;

  // Verificar si hay evidencias asociadas antes de borrar
  db.get('SELECT COUNT(*) as count FROM evidences WHERE subject_id = ?', [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (row && row.count > 0) {
      res.status(400).json({
        error: 'No se puede eliminar la asignatura porque tiene evidencias asociadas. Reásignalas primero.'
      });
      return;
    }

    db.run('DELETE FROM subjects WHERE id = ?', [id], function (err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        res.status(404).json({ error: 'Asignatura no encontrada' });
        return;
      }
      res.json({ message: 'Asignatura eliminada' });
    });
  });
});

// ==================== ENDPOINTS DE MANTENIMIENTO DEL SISTEMA ====================

// 12. Resetear base de datos y archivos
app.post('/api/system/reset', (req, res) => {
  const { mode } = req.body; // mode: 'photos' o 'students'

  if (mode === 'photos') {
    // BORRAR SOLO FOTOS: Limpia tabla evidences y archivos físicos
    db.run('DELETE FROM evidences', (err) => {
      if (err) return res.status(500).json({ error: 'Error limpiando evidencias' });

      try {
        // 1. Limpiar fotos en carpetas de alumnos
        const folders = fs.readdirSync(PORTFOLIOS_DIR);
        for (const folder of folders) {
          if (folder === '.gitkeep') continue;
          const fullPath = path.join(PORTFOLIOS_DIR, folder);
          if (fs.lstatSync(fullPath).isDirectory()) {
            if (folder === '_temporal_' || folder === 'evidences') {
              // Limpiar contenido pero mantener carpeta
              const files = fs.readdirSync(fullPath);
              for (const file of files) {
                if (file !== '.gitkeep') {
                  fs.rmSync(path.join(fullPath, file), { recursive: true, force: true });
                }
              }
            } else {
              // Antiguo sistema o carpetas personalizadas: borrar contenido
              const files = fs.readdirSync(fullPath);
              for (const file of files) {
                if (file !== '.gitkeep') {
                  fs.rmSync(path.join(fullPath, file), { recursive: true, force: true });
                }
              }
            }
          }
        }
        res.json({ message: 'Fotos y registros de evidencia borrados (incluyendo temporales)' });
      } catch (e) {
        console.error('Error cleanup:', e);
        res.status(500).json({ error: 'Error borrando archivos físicos: ' + e.message });
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

// 13. Importar evidencias desde carpeta _temporal_
app.post('/api/system/sync', async (req, res) => {
  const tempPath = path.join(PORTFOLIOS_DIR, '_temporal_');
  if (!fs.existsSync(tempPath)) {
    return res.json({ studentsCreated: 0, capturesCreated: 0, message: 'Carpeta temporal vacía' });
  }

  try {
    const files = fs.readdirSync(tempPath).filter(f => f.toLowerCase().endsWith('.jpg'));
    let capturesCreated = 0;

    // Obtener asignaturas para mapeo por nombre
    const subjects = await new Promise((resolve) => {
      db.all('SELECT id, name FROM subjects', (err, rows) => resolve(rows || []));
    });

    for (const filename of files) {
      // Intentar identificar por nombre de archivo: "Asignatura_Timestamp.jpg"
      // o "NombreAlumno_Asignatura_Timestamp.jpg" (si el usuario lo puso manual)
      const parts = filename.replace('.jpg', '').split('_');
      let identifiedSubject = null;

      // 1. Buscar si alguna parte coincide con una asignatura
      for (const part of parts) {
        identifiedSubject = subjects.find(s =>
          s.name.toLowerCase() === part.toLowerCase() ||
          part.toLowerCase().includes(s.name.toLowerCase())
        );
        if (identifiedSubject) break;
      }

      // 2. Buscar si alguna parte coincide con un alumno (solo si hay NombreAlumno_...)
      // Por ahora el backend solo lista los archivos y deja que el frontend (con IA) 
      // identifique al alumno de forma robusta. Aquí solo hacemos parsing básico.
    }

    // Nota: El usuario quiere que este botón sea "Smart". 
    // Como la IA está en el cliente, el backend simplemente devolverá la lista de archivos
    // y el frontend hará el proceso en lote.

    res.json({
      capturesCreated: 0, // El proceso real se hará desde el frontend ahora
      filesFound: files.length,
      message: 'Escaneo de temporal completado'
    });
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



// 16. Guardar captura temporal (Modo Rápido)
app.post('/api/system/temp-capture', (req, res) => {
  const { subject, subject_id, imageData } = req.body;

  if ((!subject && !subject_id) || !imageData) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  // Obtener nombre de asignatura para el prefijo si se pasa ID
  const getSubjectName = new Promise((resolve) => {
    if (subject_id) {
      db.get('SELECT name FROM subjects WHERE id = ?', [subject_id], (err, row) => {
        resolve(row ? row.name : (subject || 'General'));
      });
    } else {
      resolve(subject || 'General');
    }
  });

  getSubjectName.then(name => {
    const tempPath = path.join(PORTFOLIOS_DIR, '_temporal_');
    if (!fs.existsSync(tempPath)) fs.mkdirSync(tempPath, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    // Prefijamos la asignatura para que el asistente de clasificación la detecte luego
    const filename = `${name}_${timestamp}.jpg`;
    const filepath = path.join(tempPath, filename);

    const imageBuffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');

    fs.writeFile(filepath, imageBuffer, (err) => {
      if (err) return res.status(500).json({ error: 'Error guardando imagen temporal' });
      res.json({ message: 'Imagen guardada en temporal', filename });
    });
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
    console.log(`✅ Contraseña predeterminada: "${DEFAULT_PASSWORD}"`);
    console.log('⚠️  IMPORTANTE: Cambia la contraseña en el Panel del Docente > Seguridad.');
  } else {
    console.log('✅ Contraseña del maestro configurada.');
  }

  // 2. Verificar estado de encriptación
  const stats = await portfolioVault.getStats();

  console.log('📊 Estado del sistema de encriptación:');
  console.log(`   • Total de archivos: ${stats.totalFiles}`);
  console.log(`   • Archivos encriptados: ${stats.encryptedFiles}`);
  console.log(`   • Archivos sin encriptar: ${stats.unencryptedFiles}`);
  console.log('');
  console.log('ℹ️  Las imágenes se desencriptarán on-demand en memoria RAM.');
  console.log('ℹ️  Nunca se escribirán imágenes desencriptadas en el disco.');
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

  // ⚠️ NUEVO: Ya NO encriptamos todo al cerrar
  // Las imágenes permanecen encriptadas en disco todo el tiempo
  // Solo limpiamos el cache en memoria
  if (isAuthenticated) {
    console.log('🧹 Limpiando cache de desencriptación en memoria...');
    decryptionCache.clear();
    console.log('✅ Cache limpiado. Las imágenes permanecen encriptadas en disco.');
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

/**
 * Obtiene el ID del curso activo, o crea uno por defecto si no existe ninguno
 * @returns {Promise<number>} ID del curso activo
 */
function getOrCreateActiveCourse() {
  return new Promise((resolve, reject) => {
    // Buscar curso activo
    db.get('SELECT id FROM courses WHERE is_active = 1 ORDER BY start_date DESC LIMIT 1', (err, row) => {
      if (err) {
        return reject(err);
      }

      if (row) {
        // Ya existe un curso activo
        return resolve(row.id);
      }

      // No hay curso activo, crear uno por defecto
      const now = new Date();
      const currentYear = now.getFullYear();
      const nextYear = currentYear + 1;
      // Formato corto según calendario español
      const courseName = now.getMonth() >= 8
        ? `Curso ${currentYear}-${nextYear.toString().substring(2)}`
        : `Curso ${currentYear - 1}-${currentYear.toString().substring(2)}`;
      const startDate = now.toISOString();

      db.run(
        'INSERT INTO courses (name, start_date, is_active) VALUES (?, ?, 1)',
        [courseName, startDate],
        function (err) {
          if (err) {
            return reject(err);
          }
          console.log(`✅ Curso por defecto creado durante sync: ${courseName} (ID: ${this.lastID})`);
          resolve(this.lastID);
        }
      );
    });
  });
}

// === MIDDLEWARE DE AUTENTICACIÓN PARA SINCRONIZACIÓN ===
// Protege los endpoints de sincronización con contraseña
async function authenticateSyncRequest(req, res, next) {
  try {
    // Extraer contraseña del header Authorization
    // Formato esperado: "Authorization: Bearer {password}"
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Autenticación requerida',
        message: 'Debes proporcionar la contraseña del servidor en el header Authorization'
      });
    }

    const password = authHeader.substring(7); // Remover "Bearer "

    if (!password) {
      return res.status(401).json({
        error: 'Contraseña vacía',
        message: 'La contraseña no puede estar vacía'
      });
    }

    // Verificar contraseña usando passwordManager
    const isValid = await passwordManager.verifyPassword(password);

    if (!isValid) {
      return res.status(403).json({
        error: 'Contraseña incorrecta',
        message: 'La contraseña proporcionada no es correcta'
      });
    }

    // Guardar la contraseña en el request para usarla en desencriptación
    req.syncPassword = password;

    next();
  } catch (error) {
    console.error('❌ Error en autenticación de sync:', error);
    res.status(500).json({
      error: 'Error de autenticación',
      message: error.message
    });
  }
}

// 1. Obtener metadatos completos (PULL desde móvil)
app.get('/api/sync/metadata', authenticateSyncRequest, (req, res) => {
  const metadata = {
    students: [],
    courses: [],
    subjects: [],
    evidences: []
  };

  db.serialize(() => {
    db.all('SELECT * FROM courses', (err, rows) => {
      if (!err) {
        // Map desktop column names to mobile format
        metadata.courses = rows.map(c => ({
          ...c,
          start_date: c.start_date,
          end_date: c.end_date,
          is_active: c.is_active,
          created_at: c.created_at
        }));
      }
    });

    db.all('SELECT * FROM subjects', (err, rows) => {
      if (!err) {
        // Map desktop column names to mobile format
        metadata.subjects = rows.map(s => ({
          ...s,
          is_default: s.is_default,
          created_at: s.created_at
        }));
      }
    });

    db.all('SELECT * FROM students', (err, rows) => {
      if (!err) {
        // DEBUG: Ver datos RAW de la BD antes de mapear
        console.log('\n🔍 DEBUG - Estudiantes en BD escritorio (RAW):');
        rows.forEach(s => {
          console.log(`   ID:${s.id}, name:"${s.name}", course_id:${s.course_id}, isActive:${s.isActive}, created_at:${s.created_at}`);
        });

        // Map desktop column names to mobile format
        metadata.students = rows.map(s => ({
          id: s.id,
          courseId: s.course_id,
          name: s.name,
          faceEmbeddings192: s.face_embeddings_192,
          isActive: s.isActive !== undefined ? s.isActive : 1,
          createdAt: s.created_at || s.enrollmentDate || new Date().toISOString(),
          updatedAt: s.updated_at || s.created_at || new Date().toISOString()
        }));
      }
    });

    db.all('SELECT * FROM evidences', (err, rows) => {
      if (!err) {
        // Map desktop column names to mobile format
        metadata.evidences = rows.map(e => ({
          id: e.id,
          studentId: e.student_id,
          courseId: e.course_id,
          subjectId: e.subject_id,
          type: e.type,
          filePath: e.file_path,
          thumbnailPath: e.thumbnail_path,
          fileSize: e.file_size,
          duration: e.duration,
          captureDate: e.capture_date,
          isReviewed: e.is_reviewed,
          notes: e.notes,
          createdAt: e.created_at,
          confidence: e.confidence,
          method: e.method
        }));
      }

      // Logs detallados de lo que se envía
      console.log('\n📤 SYNC METADATA - Enviando al móvil:');
      console.log(`   📚 Cursos: ${metadata.courses.length}`);
      console.log(`   📖 Asignaturas: ${metadata.subjects.length}`);
      console.log(`   👥 Estudiantes: ${metadata.students.length}`);
      if (metadata.students.length > 0) {
        console.log('   Nombres:', metadata.students.map(s => `${s.name} (ID:${s.id}, Course:${s.courseId})`).join(', '));
      }
      console.log(`   📸 Evidencias: ${metadata.evidences.length}`);

      // Enviar respuesta cuando termine la última consulta
      res.json(metadata);
    });
  });
});

// 2. Recibir datos nuevos (PUSH desde móvil)
app.post('/api/sync/push', authenticateSyncRequest, async (req, res) => {
  const { students, subjects, evidences } = req.body;
  const results = { students: 0, subjects: 0, evidences: 0, errors: [] };

  // Logs detallados de lo que se recibe
  console.log('\n📥 SYNC PUSH - Recibiendo desde móvil:');
  console.log(`   📖 Asignaturas: ${subjects?.length || 0}`);
  if (subjects && subjects.length > 0) {
    console.log('   Nombres:', subjects.map(s => s.name).join(', '));
  }
  console.log(`   👥 Estudiantes: ${students?.length || 0}`);
  if (students && students.length > 0) {
    console.log('   Nombres:', students.map(s => `${s.name} (mobileID:${s.id})`).join(', '));
  }
  console.log(`   📸 Evidencias: ${evidences?.length || 0}`);

  try {
    // 1. Preparar infraestructura básica
    const activeCourseId = await getOrCreateActiveCourse();
    const validCourseIds = await new Promise((resolve) => {
      db.all('SELECT id FROM courses', (err, rows) => resolve((rows || []).map(r => r.id)));
    });

    // 2. Obtener estudiantes existentes para mapeo por nombre
    const existingStudents = await new Promise((resolve) => {
      db.all('SELECT id, name FROM students', (err, rows) => resolve(rows || []));
    });

    // Mapa de nombre normalizado -> desktopId
    const studentsByName = {};
    existingStudents.forEach(s => {
      studentsByName[normalizeNameForComparison(s.name)] = s.id;
    });

    // Mapa de mobileId -> desktopId (para ligar evidencias luego)
    const mobileToDesktopIdMap = {};

    // 2.5. Procesar Asignaturas (subjects) del móvil
    if (subjects && subjects.length > 0) {
      for (const subj of subjects) {
        try {
          // Verificar si la asignatura ya existe por nombre
          const existing = await new Promise((resolve) => {
            db.get('SELECT id FROM subjects WHERE name = ?', [subj.name], (err, row) => {
              resolve(row);
            });
          });

          if (existing) {
            // Actualizar asignatura existente
            await new Promise((resolve, reject) => {
              db.run(
                `UPDATE subjects SET color = ?, icon = ?, is_default = ? WHERE id = ?`,
                [subj.color || null, subj.icon || null, subj.isDefault ? 1 : 0, existing.id],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
            results.subjects++;
            console.log(`✅ Asignatura actualizada: ${subj.name}`);
          } else {
            // Crear nueva asignatura
            await new Promise((resolve, reject) => {
              db.run(
                `INSERT INTO subjects (name, color, icon, is_default, created_at) VALUES (?, ?, ?, ?, ?)`,
                [
                  subj.name,
                  subj.color || null,
                  subj.icon || null,
                  subj.isDefault ? 1 : 0,
                  subj.createdAt || new Date().toISOString()
                ],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
            results.subjects++;
            console.log(`✅ Asignatura creada: ${subj.name}`);
          }
        } catch (err) {
          console.error(`Error procesando asignatura ${subj.name}:`, err);
          results.errors.push(`Subject ${subj.name}: ${err.message}`);
        }
      }
    }

    // 3. Procesar Estudiantes (Uno a uno para gestionar el mapeo de IDs correctamente)
    if (students && students.length > 0) {
      for (const s of students) {
        try {
          let courseId = s.courseId;
          if (!courseId || courseId === 0 || !validCourseIds.includes(courseId)) {
            courseId = activeCourseId;
          }

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

          const normalizedMobileName = normalizeNameForComparison(s.name);
          const existingId = studentsByName[normalizedMobileName];

          if (existingId) {
            // Actualizar estudiante existente
            await new Promise((resolve, reject) => {
              db.run(
                `UPDATE students SET
                  course_id = ?,
                  isActive = ?,
                  face_embeddings_192 = ?
                WHERE id = ?`,
                [courseId, s.isActive ? 1 : 0, embeddingsBuffer, existingId],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
            mobileToDesktopIdMap[s.id] = existingId;
            results.students++;
            console.log(`✅ Estudiante actualizado: ${s.name} (mobileID:${s.id} -> desktopID:${existingId}, courseID:${courseId})`);
          } else {
            // Crear estudiante nuevo
            const newId = await new Promise((resolve, reject) => {
              db.run(
                `INSERT INTO students (name, course_id, enrollmentDate, isActive, face_embeddings_192)
                VALUES (?, ?, ?, ?, ?)`,
                [s.name, courseId, s.enrollmentDate, s.isActive ? 1 : 0, embeddingsBuffer],
                function (err) {
                  if (err) reject(err);
                  else resolve(this.lastID);
                }
              );
            });
            mobileToDesktopIdMap[s.id] = newId;
            results.students++;
            console.log(`✅ Estudiante creado: ${s.name} (mobileID:${s.id} -> desktopID:${newId}, courseID:${courseId})`);
          }
        } catch (err) {
          results.errors.push(`Error procesando estudiante ${s.name}: ${err.message}`);
        }
      }
      console.log('\n📋 Mapa de IDs (mobileID -> desktopID):', mobileToDesktopIdMap);
    }

    // 4. Obtener evidencias existentes para evitar duplicados (por file_path)
    const existingEvidences = await new Promise((resolve) => {
      db.all('SELECT file_path FROM evidences', (err, rows) => resolve(new Set((rows || []).map(r => r.file_path))));
    });

    // 5. Procesar Evidencias
    if (evidences && evidences.length > 0) {
      for (const e of evidences) {
        try {
          // Si ya existe la ruta, ignorar para no duplicar
          if (existingEvidences.has(e.filePath)) continue;

          // Traducir student_id usando nuestro mapa
          const desktopStudentId = mobileToDesktopIdMap[e.studentId] || e.studentId;

          console.log(`   📸 Evidencia: ${e.filePath} -> studentID móvil:${e.studentId} -> studentID escritorio:${desktopStudentId}, subjectID:${e.subjectId}`);

          await new Promise((resolve, reject) => {
            db.run(
              `INSERT INTO evidences (
                student_id, course_id, subject_id, type, file_path,
                capture_date, confidence, method, is_reviewed, file_size
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                desktopStudentId, e.courseId, e.subjectId, e.type, e.filePath,
                e.captureDate, e.confidence, e.method, e.isReviewed ? 1 : 0, e.fileSize
              ],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
          results.evidences++;
        } catch (err) {
          results.errors.push(`Error sincronizando evidencia ${e.filePath}: ${err.message}`);
        }
      }
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error('❌ Error en sincronización:', error);
    results.errors.push(`Error general de sincronización: ${error.message}`);
    res.status(500).json({ success: false, results });
  }
});

// 3. Subir archivo de evidencia (desde móvil)
app.post('/api/sync/files', authenticateSyncRequest, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filename = req.file.originalname;

    // Usar contraseña del request (autenticado por middleware)
    const password = req.syncPassword;

    const evidencesDir = path.join(PORTFOLIOS_DIR, 'evidences');
    if (!fs.existsSync(evidencesDir)) {
      fs.mkdirSync(evidencesDir, { recursive: true });
    }

    const filepath = path.join(evidencesDir, filename);

    // Escribir el archivo temporalmente desde el buffer de multer
    fs.writeFileSync(filepath, req.file.buffer);

    // Encriptar automáticamente
    let finalFilename = filename;
    try {
      const cryptoManager = require('./crypto-manager');
      await cryptoManager.encryptFile(filepath, password);
      finalFilename = filename + cryptoManager.ENCRYPTED_EXTENSION;
      console.log(`✅ Archivo sincronizado y encriptado: ${filename}`);
    } catch (encryptError) {
      console.error('⚠️  Error encriptando archivo sincronizado:', encryptError.message);
    }

    res.json({ success: true, filename: finalFilename });
  } catch (error) {
    console.error('❌ Error guardando archivo:', error);
    res.status(500).json({ error: 'Error saving file' });
  }
});

// 4. Descargar archivo de evidencia (hacia móvil)
app.get('/api/sync/files/:filename', authenticateSyncRequest, async (req, res) => {
  let { filename } = req.params;
  const password = req.syncPassword;

  // Si el filename viene con .enc, quitarlo (el móvil puede enviarlo con o sin .enc)
  const cleanFilename = filename.replace(/\.enc$/i, '');

  try {
    // Buscar archivo en carpetas planas (nuevo sistema)
    let filepath = path.join(PORTFOLIOS_DIR, 'evidences', cleanFilename);
    let encryptedFilepath = filepath + '.enc';

    // Verificar si el archivo existe (sin encriptar o encriptado)
    const fileExists = fs.existsSync(filepath);
    const encryptedExists = fs.existsSync(encryptedFilepath);

    if (!fileExists && !encryptedExists) {
      // Intentar buscar en BD para estructura antigua
      const row = await new Promise((resolve, reject) => {
        db.get('SELECT file_path FROM evidences WHERE file_path LIKE ?', [`%${filename}`], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!row) {
        return res.status(404).json({ error: 'File not found' });
      }

      // Actualizar rutas con la información de la BD
      filepath = path.join(PORTFOLIOS_DIR, row.file_path);
      encryptedFilepath = filepath + '.enc';
    }

    // Determinar tipo MIME
    const ext = path.extname(filename).toLowerCase();
    let mimeType = 'application/octet-stream';
    if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.mp4') mimeType = 'video/mp4';
    else if (ext === '.webm') mimeType = 'video/webm';
    else if (ext === '.mp3') mimeType = 'audio/mpeg';
    else if (ext === '.wav') mimeType = 'audio/wav';

    // Si existe encriptado, desencriptar en memoria y servir
    if (fs.existsSync(encryptedFilepath)) {
      console.log(`🔓 Desencriptando archivo para sincronización: ${filename}`);

      // Usar DecryptionCache para desencriptar en memoria
      const fileBuffer = await decryptionCache.get(filepath, password);

      // Servir archivo desencriptado desde memoria
      res.set('Content-Type', mimeType);
      res.set('Content-Length', fileBuffer.length);
      res.set('Cache-Control', 'no-cache'); // No cachear en el móvil
      res.send(fileBuffer);

      console.log(`✅ Archivo servido (desencriptado): ${filename} (${fileBuffer.length} bytes)`);
    }
    // Si existe sin encriptar, servirlo directamente
    else if (fs.existsSync(filepath)) {
      console.log(`📤 Sirviendo archivo sin encriptar: ${filename}`);
      res.set('Content-Type', mimeType);
      res.sendFile(filepath);
    }
    else {
      return res.status(404).json({ error: 'File not found on disk' });
    }
  } catch (error) {
    console.error(`❌ Error sirviendo archivo ${filename}:`, error);
    res.status(500).json({
      error: 'Error serving file',
      message: error.message
    });
  }
});

/**
 * Obtiene las direcciones IP locales del equipo en la red.
 * Prioriza IPs de red local típicas (192.168.1.x, 192.168.0.x, 10.x.x.x).
 * @returns {string[]} Lista de IPs
 */
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Filtrar IPv4 y que no sea loopback (127.0.0.1)
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }

  // Ordenar para priorizar redes domésticas comunes
  return addresses.sort((a, b) => {
    const scoreA = getIpScore(a);
    const scoreB = getIpScore(b);
    return scoreB - scoreA;
  });
}

function getIpScore(ip) {
  if (ip.startsWith('192.168.1.')) return 10;
  if (ip.startsWith('192.168.0.')) return 9;
  if (ip.startsWith('192.168.')) {
    // Depriorizar rangos comunes de VM/Docker
    if (ip.startsWith('192.168.56.')) return 1; // VirtualBox
    if (ip.startsWith('192.168.99.')) return 1; // Docker Machine
    return 8;
  }
  if (ip.startsWith('10.')) return 7;
  if (ip.startsWith('172.')) return 6;
  return 5;
}

// 4.1. Listar archivos pendientes en _temporal_
app.get('/api/system/pending', (req, res) => {
  const tempPath = path.join(PORTFOLIOS_DIR, '_temporal_');
  if (!fs.existsSync(tempPath)) {
    return res.json([]);
  }

  fs.readdir(tempPath, (err, files) => {
    if (err) return res.status(500).json({ error: err.message });

    const pendingFiles = files
      .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
      .map(f => ({
        name: f,
        url: `/_temporal_/${f}`
      }));

    res.json(pendingFiles);
  });
});

// 4.2. Sincronizar/Escanear carpeta temporal (trigger)
app.post('/api/system/sync', (req, res) => {
  const tempPath = path.join(PORTFOLIOS_DIR, '_temporal_');
  if (!fs.existsSync(tempPath)) {
    fs.mkdirSync(tempPath, { recursive: true });
  }
  res.json({ message: 'Carpeta temporal escaneada', path: tempPath });
});

// 4.3. Mover archivo de temporal a evidences
app.post('/api/system/move', (req, res) => {
  const { filename, studentId, subject } = req.body;

  if (!filename) {
    return res.status(400).json({ error: 'Falta el nombre del archivo (filename)' });
  }
  if (!studentId || isNaN(parseInt(studentId))) {
    return res.status(400).json({ error: 'Falta o es inválido el ID del estudiante (studentId)' });
  }

  const tempPath = path.join(PORTFOLIOS_DIR, '_temporal_', filename);
  const evidencesDir = path.join(PORTFOLIOS_DIR, 'evidences');

  if (!fs.existsSync(tempPath)) {
    return res.status(404).json({ error: `El archivo original no existe: ${filename}` });
  }

  if (!fs.existsSync(evidencesDir)) {
    try {
      fs.mkdirSync(evidencesDir, { recursive: true });
    } catch (e) {
      return res.status(500).json({ error: 'Error creando carpeta evidences: ' + e.message });
    }
  }

  // Resolver ID de asignatura (puede venir nombre o ID)
  db.serialize(() => {
    // Preparar promesa para obtener ID de asignatura
    const getSubjectId = new Promise((resolve, reject) => {
      if (!subject) {
        // Fallback: buscar la primera asignatura disponible
        db.get('SELECT id FROM subjects ORDER BY id ASC LIMIT 1', (err, row) => {
          if (err) reject(err);
          else resolve(row ? row.id : 1); // ID 1 como último recurso
        });
        return;
      }

      // Si es un número (o string numérico), asumir que es ID
      if (!isNaN(parseInt(subject)) && String(parseInt(subject)) === String(subject)) {
        return resolve(parseInt(subject));
      }

      // Si es texto (o el parseInt no coincide), buscar por nombre
      db.get('SELECT id FROM subjects WHERE name = ?', [subject], (err, row) => {
        if (err) reject(err);
        else if (row) resolve(row.id);
        else {
          // Si no existe, buscar la primera disponible
          db.get('SELECT id FROM subjects ORDER BY id ASC LIMIT 1', (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.id : 1);
          });
        }
      });
    });

    getSubjectId.then(async subjectId => {
      // 1. Mover archivo
      const destPath = path.join(evidencesDir, filename);

      try {
        // Usamos copy + unlink para evitar errores entre diferentes dispositivos/particiones
        fs.copyFileSync(tempPath, destPath);
        fs.unlinkSync(tempPath);
      } catch (err) {
        console.error('Error moviendo archivo:', err);
        return res.status(500).json({ error: 'Error al mover el archivo físico: ' + err.message });
      }

      // 1.1. Encriptar automáticamente si el usuario está autenticado
      let finalFilename = filename;
      if (isAuthenticated && currentPassword) {
        try {
          const cryptoManager = require('./crypto-manager');
          await cryptoManager.encryptFile(destPath, currentPassword);
          finalFilename = filename + cryptoManager.ENCRYPTED_EXTENSION;
          console.log(`🔒 Archivo movido y encriptado: ${filename}`);
        } catch (encryptError) {
          console.error('⚠️  Error encriptando archivo movido:', encryptError.message);
        }
      }

      // 2. Obtener datos del estudiante para la consistencia
      db.get('SELECT course_id FROM students WHERE id = ?', [studentId], (err, student) => {
        if (err) {
          return res.status(500).json({ error: 'Error consultando estudiante: ' + err.message });
        }

        if (!student) {
          return res.status(404).json({ error: `Estudiante no encontrado con ID: ${studentId}` });
        }

        const courseId = student.course_id || 1;
        const captureDate = new Date().toISOString();
        const relativePath = `evidences/${finalFilename}`;

        // Obtener tamaño del archivo encriptado (si existe)
        const finalPath = path.join(evidencesDir, finalFilename);
        const fileSize = fs.existsSync(finalPath) ? fs.statSync(finalPath).size : 0;

        // 3. Insertar en BD
        db.run(
          `INSERT INTO evidences (
              student_id, course_id, subject_id, type, file_path, 
              capture_date, confidence, method, is_reviewed, created_at, file_size
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            studentId,
            courseId,
            subjectId,
            'IMG',
            relativePath,
            captureDate,
            1, // Confidence (manual classification)
            'manual_import',
            1, // Reviewed
            captureDate,
            fileSize
          ],
          function (err) {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, id: this.lastID });
          }
        );
      });
    }).catch(err => {
      res.status(500).json({ error: 'Error resolviendo asignatura: ' + err.message });
    });
  });
});

// 5. Obtener información del sistema (IP y puerto para sincronización)
app.get('/api/system/info', (req, res) => {
  const ips = getLocalIpAddresses();
  res.json({
    ip: ips.length > 0 ? ips[0] : 'localhost', // Para compatibilidad
    ips: ips,
    port: PORT,
    status: 'online'
  });
});

// 6. Obtener estadísticas del sistema (alumnos, fotos, ocupación)
app.get('/api/system/stats', (req, res) => {
  const stats = {
    students: 0,
    evidences: 0,
    totalSize: 0
  };

  db.get('SELECT COUNT(*) as count FROM students WHERE isActive = 1', (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    stats.students = row.count;

    db.get('SELECT COUNT(*) as count, SUM(file_size) as size FROM evidences', (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      stats.evidences = row.count || 0;
      stats.totalSize = row.size || 0;

      res.json(stats);
    });
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
