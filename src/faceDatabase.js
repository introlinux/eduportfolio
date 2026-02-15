/**
 * Face Database - Facial Recognition Database Manager
 *
 * Manages face descriptors storage and matching for student recognition.
 * Uses SQLite database to store face profiles with multiple descriptors per student.
 *
 * @module faceDatabase
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Face recognition constants
const FACE_DESCRIPTOR_LENGTH = 128;
const DEFAULT_MAX_DESCRIPTORS = 10;
const DEFAULT_RECOGNITION_THRESHOLD = 0.6;
const CONFIDENCE_NORMALIZATION_FACTOR = 1.5;

// Database configuration
const USER_DATA_PATH = process.env.USER_DATA_PATH;
const BASE_DATA_PATH = USER_DATA_PATH || path.join(__dirname, '..');
const DATA_DIR = path.join(BASE_DATA_PATH, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const defaultDbPath = path.join(DATA_DIR, 'eduportfolio.db');
const dbPath = process.env.DB_PATH || defaultDbPath;

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening face database:', err);
  }
});

/**
 * Initializes the face profiles table
 * Stores facial descriptors for each student for recognition purposes
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
  `);

  // Database migration: handle legacy column names
  db.all("PRAGMA table_info(face_profiles)", (err, columns) => {
    if (err) return;

    const hasFaceDescriptor = columns.some(col => col.name === 'faceDescriptor');
    const hasFaceDescriptors = columns.some(col => col.name === 'faceDescriptors');
    const hasDescriptorCount = columns.some(col => col.name === 'descriptorCount');
    const hasTrainingImageCount = columns.some(col => col.name === 'trainingImageCount');

    if (!hasFaceDescriptors) {
      db.run("ALTER TABLE face_profiles ADD COLUMN faceDescriptors TEXT");
    }

    if (!hasDescriptorCount) {
      db.run("ALTER TABLE face_profiles ADD COLUMN descriptorCount INTEGER DEFAULT 0", (err) => {
        if (!err && hasTrainingImageCount) {
          db.run("UPDATE face_profiles SET descriptorCount = trainingImageCount");
        }
      });
    }

    if (hasFaceDescriptor && !hasFaceDescriptors) {
      db.all("SELECT studentId, faceDescriptor FROM face_profiles", (err, rows) => {
        if (err || !rows) return;

        const migrationPromises = rows.map(row => {
          return new Promise((resolve) => {
            if (!row.faceDescriptor) {
              resolve();
              return;
            }

            try {
              const oldDescriptor = JSON.parse(row.faceDescriptor);
              const newDescriptors = [oldDescriptor];
              db.run(
                "UPDATE face_profiles SET faceDescriptors = ? WHERE studentId = ?",
                [JSON.stringify(newDescriptors), row.studentId],
                () => resolve()
              );
            } catch (error) {
              resolve();
            }
          });
        });

        Promise.all(migrationPromises).then(() => {
          db.run("ALTER TABLE face_profiles DROP COLUMN faceDescriptor");
          db.run("ALTER TABLE face_profiles DROP COLUMN trainingImageCount");
        });
      });
    } else if (hasFaceDescriptor) {
      db.run("ALTER TABLE face_profiles DROP COLUMN faceDescriptor");
    }

    if (hasTrainingImageCount && hasDescriptorCount) {
      db.run("ALTER TABLE face_profiles DROP COLUMN trainingImageCount");
    }
  });

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
 * Saves a face descriptor for a student
 * Adds the new descriptor to the existing array (maximum configurable)
 *
 * @param {number} studentId - Student ID
 * @param {Array} faceDescriptor - Array of 128 numbers (face descriptor)
 * @param {number} maxDescriptors - Maximum descriptors to store
 * @returns {Promise<Object>} Save result with descriptor count
 */
function saveFaceProfile(studentId, faceDescriptor, maxDescriptors = DEFAULT_MAX_DESCRIPTORS) {
  return new Promise((resolve, reject) => {
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
          try {
            descriptors = JSON.parse(row.faceDescriptors);
          } catch (error) {
            descriptors = [];
          }
        }

        descriptors.push(faceDescriptor);

        if (descriptors.length > maxDescriptors) {
          descriptors = descriptors.slice(-maxDescriptors);
        }

        const descriptorsJson = JSON.stringify(descriptors);
        const count = descriptors.length;

        db.run(
          `INSERT OR REPLACE INTO face_profiles (studentId, faceDescriptors, descriptorCount, lastUpdated)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
          [studentId, descriptorsJson, count],
          function (err) {
            if (err) {
              reject(err);
              return;
            }

            resolve({
              studentId,
              descriptorCount: count,
              message: `Face profile updated (${count} descriptors)`
            });
          }
        );
      }
    );
  });
}

/**
 * Calculates average descriptor from an array of descriptors
 *
 * @param {Array<Array<number>>} descriptors - Array of face descriptors
 * @returns {Array<number>|null} Average descriptor or null
 */
function calculateAverageDescriptor(descriptors) {
  if (!descriptors || descriptors.length === 0) {
    return null;
  }

  if (descriptors.length === 1) {
    return descriptors[0];
  }

  const avgDescriptor = new Array(FACE_DESCRIPTOR_LENGTH).fill(0);

  descriptors.forEach(descriptor => {
    for (let i = 0; i < FACE_DESCRIPTOR_LENGTH; i++) {
      avgDescriptor[i] += descriptor[i];
    }
  });

  for (let i = 0; i < FACE_DESCRIPTOR_LENGTH; i++) {
    avgDescriptor[i] /= descriptors.length;
  }

  return avgDescriptor;
}

/**
 * Gets the average face descriptor for a student
 *
 * @param {number} studentId - Student ID
 * @returns {Promise<Array<number>|null>} Average descriptor or null
 */
function getFaceProfile(studentId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT faceDescriptors FROM face_profiles WHERE studentId = ?`,
      [studentId],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        if (!row) {
          resolve(null);
          return;
        }

        try {
          const descriptors = JSON.parse(row.faceDescriptors);
          const avgDescriptor = calculateAverageDescriptor(descriptors);
          resolve(avgDescriptor);
        } catch (error) {
          resolve(null);
        }
      }
    );
  });
}

/**
 * Gets all face profiles (averaged) for matching
 *
 * @returns {Promise<Object>} Object mapping studentId to average descriptor
 */
function getAllFaceProfiles() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT studentId, faceDescriptors FROM face_profiles`,
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        const profiles = {};

        rows.forEach(row => {
          try {
            const descriptors = JSON.parse(row.faceDescriptors);
            const avgDescriptor = calculateAverageDescriptor(descriptors);

            if (avgDescriptor) {
              profiles[row.studentId] = avgDescriptor;
            }
          } catch (error) {
            // Skip invalid profiles
          }
        });

        resolve(profiles);
      }
    );
  });
}

/**
 * Calculates Euclidean distance between two descriptors
 * Used for face comparison (lower distance = more similar)
 *
 * @param {Array<number>} descriptor1 - First face descriptor
 * @param {Array<number>} descriptor2 - Second face descriptor
 * @returns {number} Distance between descriptors
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
 * Finds the best matching student based on face descriptor
 *
 * @param {Array<number>} faceDescriptor - Captured face descriptor
 * @param {number} threshold - Maximum distance to consider a match
 * @returns {Promise<Object|null>} Best match or null if no match found
 */
async function findMatchingStudent(faceDescriptor, threshold = DEFAULT_RECOGNITION_THRESHOLD) {
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
          confidence: Math.max(0, 1 - (distance / CONFIDENCE_NORMALIZATION_FACTOR))
        };
      }
    }

    if (bestMatch && minDistance < threshold) {
      return bestMatch;
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Deletes a face profile for a student
 *
 * @param {number} studentId - Student ID
 * @returns {Promise<Object>} Delete result with number of changes
 */
function deleteFaceProfile(studentId) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM face_profiles WHERE studentId = ?`,
      [studentId],
      function (err) {
        if (err) {
          reject(err);
          return;
        }
        resolve({ changes: this.changes });
      }
    );
  });
}

/**
 * Resets face profile (deletes all descriptors for retraining)
 *
 * @param {number} studentId - Student ID
 * @returns {Promise<Object>} Reset result
 */
function resetFaceProfile(studentId) {
  return deleteFaceProfile(studentId);
}

/**
 * Gets face profile information (number of stored descriptors)
 *
 * @param {number} studentId - Student ID
 * @returns {Promise<Object|null>} Profile info or null
 */
function getFaceProfileInfo(studentId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT descriptorCount, lastUpdated FROM face_profiles WHERE studentId = ?`,
      [studentId],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        if (!row) {
          resolve(null);
          return;
        }

        resolve({
          studentId,
          descriptorCount: row.descriptorCount,
          lastUpdated: row.lastUpdated
        });
      }
    );
  });
}

/**
 * Logs a recognition attempt for auditing purposes
 *
 * @param {number|null} studentId - Student ID (or null if not recognized)
 * @param {number} confidence - Confidence level (0-1)
 * @param {string} result - 'success', 'partial_match', or 'no_match'
 */
function logRecognitionAttempt(studentId, confidence, result) {
  db.run(
    `INSERT INTO recognition_logs (studentId, confidence, result) VALUES (?, ?, ?)`,
    [studentId, confidence, result]
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
