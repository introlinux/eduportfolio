
describe('FaceDatabase Module', () => {
    let faceDatabase;
    let mockRun;
    let mockGet;
    let mockAll;

    beforeEach(() => {
        // Reset modules to ensure fresh require and mocks
        jest.resetModules();

        // Create fresh mock functions for each test
        mockRun = jest.fn();
        mockGet = jest.fn();
        mockAll = jest.fn();

        // setup interface for the mock database instance
        const mockDbInstance = {
            run: mockRun,
            get: mockGet,
            all: mockAll
        };

        // Use doMock to avoid hoisting and allow closure access
        jest.doMock('sqlite3', () => ({
            verbose: () => ({
                Database: jest.fn(() => mockDbInstance)
            })
        }));

        // Require the module UNDER TEST after mocking
        faceDatabase = require('../../src/faceDatabase');
    });

    describe('calculateDistance', () => {
        test('should calculate correct Euclidean distance', () => {
            const d1 = [0, 0, 0];
            const d2 = [1, 1, 1];
            const result = faceDatabase.calculateDistance(d1, d2);
            expect(result).toBeCloseTo(1.732, 3);
        });

        test('should return 0 for identical descriptors', () => {
            const d1 = [0.5, 0.5];
            const result = faceDatabase.calculateDistance(d1, d1);
            expect(result).toBe(0);
        });
    });

    describe('saveFaceProfile', () => {
        test('should save profile successfully', async () => {
            // Setup mock behavior for success
            // db.run(sql, params, callback)
            mockRun.mockImplementation((query, params, callback) => {
                callback(null); // Success
            });

            const result = await faceDatabase.saveFaceProfile(1, [0.1]);

            expect(result.message).toBe('Perfil facial guardado');
            expect(mockRun).toHaveBeenCalled();
        });

        test('should reject on DB error', async () => {
            mockRun.mockImplementation((query, params, callback) => {
                callback(new Error('DB Error'));
            });

            await expect(faceDatabase.saveFaceProfile(1, [])).rejects.toThrow('DB Error');
        });
    });

    describe('findMatchingStudent', () => {
        test('should find matching student', async () => {
            const stored = [1.0, 1.0];
            mockAll.mockImplementation((query, callback) => {
                callback(null, [
                    { studentId: 1, faceDescriptor: JSON.stringify(stored) }
                ]);
            });

            const match = await faceDatabase.findMatchingStudent([1.0, 1.0]);
            expect(match.studentId).toBe(1);
        });
    });
});
