/**
 * Jest Setup File
 * 
 * Global setup and configuration for all tests
 * Runs before each test suite
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Suppress logging during tests

// Disable console output in tests (optional)
// Uncomment to reduce test output noise
// global.console.log = jest.fn();
// global.console.warn = jest.fn();
// global.console.error = jest.fn();

// Increase timeout for integration tests involving file I/O
jest.setTimeout(10000);

// Mock crypto.randomBytes for deterministic tests when needed
const originalRandomBytes = require('crypto').randomBytes;
global.mockRandomBytes = originalRandomBytes;
