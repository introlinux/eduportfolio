const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// 1. Define path for test DB
const TEST_DB_PATH = path.join(__dirname, 'test.db');

// Set env var BEFORE requiring the module
process.env.DB_PATH = TEST_DB_PATH;

describe('Face Recognition Integration Test (Real DB)', () => {
    let faceDatabase;
    let db;

    beforeAll((done) => {
        // Clean up previous test runs
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }

        // Require the module (this triggers DB connection to TEST_DB_PATH)
        faceDatabase = require('../../src/faceDatabase');

        // Create direct connection for setup
        db = new sqlite3.Database(TEST_DB_PATH);

        db.serialize(() => {
            // Create students table
            db.run(`CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY, name TEXT)`, (err) => {
                if (err) return done(err);

                // Insert dummy student
                db.run(`INSERT INTO students (id, name) VALUES (1, 'Test Student')`, (err) => {
                    if (err) return done(err);
                    // Allow some time for initFaceDatabase
                    setTimeout(done, 100);
                });
            });
        });
    });

    afterAll((done) => {
        db.close(() => {
            if (fs.existsSync(TEST_DB_PATH)) {
                try { fs.unlinkSync(TEST_DB_PATH); } catch (e) { }
            }
            done();
        });
    });

    test('Full Flow: Save Profile -> Find Match', async () => {
        const studentId = 1;
        const originalDescriptor = Array(128).fill(0).map(() => Math.random());

        // 1. Save Profile
        const saveResult = await faceDatabase.saveFaceProfile(studentId, originalDescriptor);
        expect(saveResult.message).toBe('Perfil facial actualizado (1 imágenes)');

        // 2. Search with EXACT same descriptor
        const matchExact = await faceDatabase.findMatchingStudent(originalDescriptor);
        expect(matchExact).not.toBeNull();
        expect(matchExact.studentId).toBe(studentId);
        expect(matchExact.distance).toBe(0);

        // 3. Search with SLIGHTLY modified descriptor
        const noisyDescriptor = [...originalDescriptor];
        noisyDescriptor[0] += 0.05;

        const matchNoisy = await faceDatabase.findMatchingStudent(noisyDescriptor);
        expect(matchNoisy).not.toBeNull();
        expect(matchNoisy.studentId).toBe(studentId);
        expect(matchNoisy.distance).toBeCloseTo(0.05, 3);
    });

    test('Should return null for non-matching face', async () => {
        const farDescriptor = Array(128).fill(10.0);
        const match = await faceDatabase.findMatchingStudent(farDescriptor);
        expect(match).toBeNull();
    });
});
