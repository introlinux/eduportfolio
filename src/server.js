const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const faceDbModule = null; // Se cargará después de asegurar las carpetas

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
    // Tabla de alumnos
    db.run(`
      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        enrollmentDate DATETIME DEFAULT CURRENT_TIMESTAMP,
        isActive BOOLEAN DEFAULT 1
      )
    `);

    // Tabla de registros de captura
    // Nota: isClassified ya está en el CREATE TABLE para nuevas bases de datos
    db.run(`
      CREATE TABLE IF NOT EXISTS captures (
        id INTEGER PRIMARY KEY,
        studentId INTEGER NOT NULL,
        subject TEXT NOT NULL,
        imagePath TEXT NOT NULL,
        captureDate DATETIME DEFAULT CURRENT_TIMESTAMP,
        confidence REAL,
        method TEXT,
        isClassified BOOLEAN DEFAULT 0,
        FOREIGN KEY(studentId) REFERENCES students(id)
      )
    `);

    // Migración: Añadir columna isClassified SOLO si no existe (para BDs antiguas)
    db.all("PRAGMA table_info(captures)", (err, columns) => {
      if (err) {
        console.error('Error checking captures table:', err);
        return;
      }

      const hasIsClassified = columns.some(col => col.name === 'isClassified');
      if (!hasIsClassified) {
        db.run("ALTER TABLE captures ADD COLUMN isClassified BOOLEAN DEFAULT 0", (err) => {
          if (err) {
            console.error('Error adding isClassified column:', err);
          } else {
            console.log('✅ Columna isClassified añadida a tabla captures (migración)');
          }
        });
      }
    });

    // Tabla de sesiones (Modo Sesión del Profesor)
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY,
        subject TEXT NOT NULL,
        startTime DATETIME DEFAULT CURRENT_TIMESTAMP,
        duration INTEGER DEFAULT 900,
        isActive BOOLEAN DEFAULT 1
      )
    `);

    console.log('📊 Tablas de base de datos inicializadas');
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

// ==================== API ENDPOINTS ====================

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

  // Obtener nombre del alumno para la carpeta
  db.get('SELECT name FROM students WHERE id = ?', [studentId], (err, student) => {
    if (err || !student) {
      res.status(500).json({ error: 'Alumno no encontrado' });
      return;
    }

    const studentFolderName = getStudentFolderName(studentId, student.name);
    // Usar la ruta dinámica PORTFOLIOS_DIR
    const studentDir = path.join(PORTFOLIOS_DIR, studentFolderName);
    const subjectDir = path.join(studentDir, subject);

    // Migración automática: si existe la carpeta vieja student_ID, renombrarla
    const oldStudentDir = path.join(PORTFOLIOS_DIR, `student_${studentId}`);
    if (fs.existsSync(oldStudentDir) && !fs.existsSync(studentDir)) {
      try {
        fs.renameSync(oldStudentDir, studentDir);
        console.log(`📂 Migrada carpeta: student_${studentId} -> ${studentFolderName}`);
      } catch (e) {
        console.error('Error migrando carpeta:', e);
      }
    }

    if (!fs.existsSync(subjectDir)) {
      fs.mkdirSync(subjectDir, { recursive: true });
    }

    // Generar nombre de archivo con timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `${timestamp}.jpg`;
    const filepath = path.join(subjectDir, filename);

    // Guardar imagen (base64 → binary)
    const imageBuffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    fs.writeFile(filepath, imageBuffer, (err) => {
      if (err) {
        res.status(500).json({ error: 'Error guardando imagen' });
        return;
      }

      // Guardar metadatos en BD
      const relativePath = `${studentFolderName}/${subject}/${filename}`;
      db.run(
        'INSERT INTO captures (studentId, subject, imagePath, method, confidence, isClassified) VALUES (?, ?, ?, ?, ?, ?)',
        [studentId, subject, relativePath, method || 'manual', confidence || 0, isClassified ? 1 : 0],
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

// 4. Obtener capturas de un alumno
app.get('/api/captures/:studentId', (req, res) => {
  const { studentId } = req.params;
  db.all(
    'SELECT * FROM captures WHERE studentId = ? ORDER BY captureDate DESC',
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

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor web EduPortfolio escuchando en http://localhost:${PORT}`);
  console.log(`📁 Carpeta de portfolios: ${PORTFOLIOS_DIR}`);
  console.log(`📊 Base de datos: ${dbPath}\n`);
});
