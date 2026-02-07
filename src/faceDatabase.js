const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const USER_DATA_PATH = process.env.USER_DATA_PATH;
const BASE_DATA_PATH = USER_DATA_PATH || path.join(__dirname, '..');
const DATA_DIR = path.join(BASE_DATA_PATH, 'data');

// Asegurar que existe la carpeta de datos
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const defaultDbPath = path.join(DATA_DIR, 'eduportfolio.db');
const dbPath = process.env.DB_PATH || defaultDbPath;

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Error al abrir la base de datos de rostros:', err);
  } else {
    // console.log('✅ Base de datos de rostros conectada en:', dbPath);
  }
});

/**
 * Inicializa la tabla de perfiles faciales
 * Almacena los descriptores faciales de cada alumno para reconocimiento
 */
function initFaceDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS face_profiles (
      id INTEGER PRIMARY KEY,
      studentId INTEGER NOT NULL UNIQUE,
      faceDescriptors TEXT NOT NULL,
      descriptorCount INTEGER DEFAULT 1,
      createdDate DATETIME DEFAULT CURRENT_TIMESTAMP,
      lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(studentId) REFERENCES students(id)
    )
  `, (err) => {
    if (!err) {
      console.log('📊 Tabla face_profiles inicializada');
    }
  });

  // Migración: Renombrar columna si existe la versión antigua
  db.all("PRAGMA table_info(face_profiles)", (err, columns) => {
    if (err) return;

    const hasFaceDescriptor = columns.some(col => col.name === 'faceDescriptor');
    const hasFaceDescriptors = columns.some(col => col.name === 'faceDescriptors');
    const hasDescriptorCount = columns.some(col => col.name === 'descriptorCount');
    const hasTrainingImageCount = columns.some(col => col.name === 'trainingImageCount');

    // 1. Añadir faceDescriptors si no existe
    if (!hasFaceDescriptors) {
      console.log('🔄 Añadiendo columna faceDescriptors...');
      db.run("ALTER TABLE face_profiles ADD COLUMN faceDescriptors TEXT");
    }

    // 2. Añadir descriptorCount si no existe
    if (!hasDescriptorCount) {
      console.log('🔄 Añadiendo columna descriptorCount...');
      db.run("ALTER TABLE face_profiles ADD COLUMN descriptorCount INTEGER DEFAULT 0", (err) => {
        if (!err && hasTrainingImageCount) {
          // Copiar datos de la columna antigua si existe
          db.run("UPDATE face_profiles SET descriptorCount = trainingImageCount");
        }
      });
    }

    // 3. Migrar datos de rostro único a array si es necesario
    if (hasFaceDescriptor && !hasFaceDescriptors) {
      console.log('🔄 Migrando descriptores faciales antiguos...');
      db.all("SELECT studentId, faceDescriptor FROM face_profiles", (err, rows) => {
        if (err || !rows) return;

        const promises = rows.map(row => {
          return new Promise((resolve) => {
            try {
              if (row.faceDescriptor) {
                const oldDescriptor = JSON.parse(row.faceDescriptor);
                const newDescriptors = [oldDescriptor];
                db.run(
                  "UPDATE face_profiles SET faceDescriptors = ? WHERE studentId = ?",
                  [JSON.stringify(newDescriptors), row.studentId],
                  (err) => resolve()
                );
              } else {
                resolve();
              }
            } catch (e) {
              console.error(`Error migrando rostro de alumno ${row.studentId}:`, e);
              resolve();
            }
          });
        });

        // Una vez migrados los datos, intentar borrar las columnas antiguas
        Promise.all(promises).then(() => {
          console.log('✅ Datos migrados. Intentando limpiar columnas antiguas...');
          // Usamos una sintaxis segura try-catch en SQL si es posible, o simplemente lanzamos el comando
          // SQLite moderno soporta DROP COLUMN
          db.run("ALTER TABLE face_profiles DROP COLUMN faceDescriptor", (err) => {
            if (!err) console.log('🗑️ Columna faceDescriptor eliminada');
          });
          db.run("ALTER TABLE face_profiles DROP COLUMN trainingImageCount", (err) => {
            if (!err) console.log('🗑️ Columna trainingImageCount eliminada');
          });
        });
      });
    } else if (hasFaceDescriptor) {
      // Si ya tiene faceDescriptors pero sigue existiendo la antigua
      console.log('🧹 Limpiando columna residual faceDescriptor...');
      db.run("ALTER TABLE face_profiles DROP COLUMN faceDescriptor", (err) => {
        if (!err) console.log('🗑️ Columna faceDescriptor eliminada');
      });
    }

    if (hasTrainingImageCount && hasDescriptorCount) {
      console.log('🧹 Limpiando columna residual trainingImageCount...');
      db.run("ALTER TABLE face_profiles DROP COLUMN trainingImageCount", (err) => {
        if (!err) console.log('🗑️ Columna trainingImageCount eliminada');
      });
    }
  });

  // Inicializar tabla de logs
  db.run(`
    CREATE TABLE IF NOT EXISTS recognition_logs (
      id INTEGER PRIMARY KEY,
      studentId INTEGER,
      confidence REAL,
      result TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Guardar descriptor facial de un alumno
 * Añade el nuevo descriptor al array existente (máximo 10)
 * @param {number} studentId - ID del alumno
 * @param {Array} faceDescriptor - Array de 128 números (descriptor facial)
 * @param {number} maxDescriptors - Máximo de descriptores a guardar (por defecto 10)
 * @returns {Promise}
 */
function saveFaceProfile(studentId, faceDescriptor, maxDescriptors = 10) {
  return new Promise((resolve, reject) => {
    // Primero, obtener descriptores existentes
    db.get(
      `SELECT faceDescriptors, descriptorCount FROM face_profiles WHERE studentId = ?`,
      [studentId],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        let descriptors = [];

        if (row) {
          // Ya existe un perfil, añadir al array
          try {
            descriptors = JSON.parse(row.faceDescriptors);
          } catch (e) {
            console.error('Error parseando descriptores:', e);
            descriptors = [];
          }
        }

        // Añadir nuevo descriptor
        descriptors.push(faceDescriptor);

        // Limitar a maxDescriptors (mantener los más recientes)
        if (descriptors.length > maxDescriptors) {
          descriptors = descriptors.slice(-maxDescriptors);
        }

        const descriptorsJson = JSON.stringify(descriptors);
        const count = descriptors.length;

        // Guardar o actualizar
        db.run(
          `INSERT OR REPLACE INTO face_profiles (studentId, faceDescriptors, descriptorCount, lastUpdated) 
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
          [studentId, descriptorsJson, count],
          function (err) {
            if (err) {
              reject(err);
            } else {
              resolve({
                studentId,
                descriptorCount: count,
                message: `Perfil facial actualizado (${count} imágenes)`
              });
            }
          }
        );
      }
    );
  });
}

/**
 * Calcular descriptor promedio de un array de descriptores
 * @param {Array} descriptors - Array de descriptores faciales
 * @returns {Array} - Descriptor promedio
 */
function calculateAverageDescriptor(descriptors) {
  if (!descriptors || descriptors.length === 0) return null;
  if (descriptors.length === 1) return descriptors[0];

  const avgDescriptor = new Array(128).fill(0);

  // Sumar todos los descriptores
  descriptors.forEach(descriptor => {
    for (let i = 0; i < 128; i++) {
      avgDescriptor[i] += descriptor[i];
    }
  });

  // Dividir por el número de descriptores para obtener el promedio
  for (let i = 0; i < 128; i++) {
    avgDescriptor[i] /= descriptors.length;
  }

  return avgDescriptor;
}

/**
 * Obtener descriptor facial promedio de un alumno
 * @param {number} studentId - ID del alumno
 * @returns {Promise} - Descriptor promedio o null
 */
function getFaceProfile(studentId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT faceDescriptors FROM face_profiles WHERE studentId = ?`,
      [studentId],
      (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          try {
            const descriptors = JSON.parse(row.faceDescriptors);
            const avgDescriptor = calculateAverageDescriptor(descriptors);
            resolve(avgDescriptor);
          } catch (e) {
            console.error('Error parseando descriptores:', e);
            resolve(null);
          }
        } else {
          resolve(null);
        }
      }
    );
  });
}

/**
 * Obtener todos los perfiles faciales (promediados) para búsqueda
 * @returns {Promise}
 */
function getAllFaceProfiles() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT studentId, faceDescriptors FROM face_profiles`,
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const profiles = {};
          rows.forEach(row => {
            try {
              const descriptors = JSON.parse(row.faceDescriptors);
              const avgDescriptor = calculateAverageDescriptor(descriptors);
              if (avgDescriptor) {
                profiles[row.studentId] = avgDescriptor;
              }
            } catch (e) {
              console.error(`Error procesando perfil de alumno ${row.studentId}:`, e);
            }
          });
          resolve(profiles);
        }
      }
    );
  });
}

/**
 * Calcular distancia euclidiana entre dos descriptores
 * Usada para comparar rostros
 * @param {Array} descriptor1 
 * @param {Array} descriptor2 
 * @returns {number} - Distancia (menor = más similar)
 */
function calculateDistance(descriptor1, descriptor2) {
  if (!descriptor1 || !descriptor2 || descriptor1.length !== descriptor2.length) {
    return Infinity;
  }

  let sumSquaredDiff = 0;
  for (let i = 0; i < descriptor1.length; i++) {
    const diff = descriptor1[i] - descriptor2[i];
    sumSquaredDiff += diff * diff;
  }
  return Math.sqrt(sumSquaredDiff);
}

/**
 * Encontrar el alumno más similar basado en descriptor facial
 * @param {Array} faceDescriptor - Descriptor del rostro capturado
 * @param {number} threshold - Distancia máxima para considerar coincidencia (por defecto 0.6)
 * @returns {Promise}
 */
async function findMatchingStudent(faceDescriptor, threshold = 0.6) {
  try {
    const profiles = await getAllFaceProfiles();

    let bestMatch = null;
    let minDistance = Infinity;

    for (const [studentId, storedDescriptor] of Object.entries(profiles)) {
      const distance = calculateDistance(faceDescriptor, storedDescriptor);

      if (distance < minDistance) {
        minDistance = distance;
        bestMatch = {
          studentId: parseInt(studentId),
          distance: distance,
          confidence: Math.max(0, 1 - (distance / 1.5)) // Normalizar a 0-1
        };
      }
    }

    if (bestMatch && minDistance < threshold) {
      return bestMatch;
    }

    return null;
  } catch (error) {
    console.error('Error encontrando estudiante:', error);
    return null;
  }
}

/**
 * Registrar intento de reconocimiento para auditoría
 * @param {number} studentId - ID del alumno (o null si no se reconoció)
 * @param {number} confidence - Nivel de confianza (0-1)
 * @param {string} result - 'success', 'partial_match', 'no_match'
 */
/**
 * Eliminar perfil facial de un alumno
 * @param {number} studentId - ID del alumno
 * @returns {Promise}
 */
function deleteFaceProfile(studentId) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM face_profiles WHERE studentId = ?`,
      [studentId],
      function (err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      }
    );
  });
}

/**
 * Resetear perfil facial (borrar todos los descriptores para re-entrenar desde cero)
 * @param {number} studentId - ID del alumno
 * @returns {Promise}
 */
function resetFaceProfile(studentId) {
  return deleteFaceProfile(studentId);
}

/**
 * Obtener información del perfil facial (número de descriptores almacenados)
 * @param {number} studentId - ID del alumno
 * @returns {Promise}
 */
function getFaceProfileInfo(studentId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT descriptorCount, lastUpdated FROM face_profiles WHERE studentId = ?`,
      [studentId],
      (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          resolve({
            studentId,
            descriptorCount: row.descriptorCount,
            lastUpdated: row.lastUpdated
          });
        } else {
          resolve(null);
        }
      }
    );
  });
}

function logRecognitionAttempt(studentId, confidence, result) {
  db.run(
    `INSERT INTO recognition_logs (studentId, confidence, result) VALUES (?, ?, ?)`,
    [studentId, confidence, result],
    (err) => {
      if (err) console.error('Error registrando intento:', err);
    }
  );
}

initFaceDatabase();

module.exports = {
  saveFaceProfile,
  getFaceProfile,
  getFaceProfileInfo,
  getAllFaceProfiles,
  calculateDistance,
  calculateAverageDescriptor,
  findMatchingStudent,
  logRecognitionAttempt,
  deleteFaceProfile,
  resetFaceProfile
};
