/**
 * Jest Configuration
 * 
 * Test runner configuration for EduPortfolio desktop application
 * Handles unit tests, integration tests, and coverage reporting
 */

module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Test paths
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js'
  ],

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  setupFiles: [],

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/main.js', // Electron app is difficult to test
    '!src/assets/**'
  ],

  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'text-summary', 'html', 'lcov', 'json'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/',
    '/.git/'
  ],

  // Coverage thresholds (goals)
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 70,
      lines: 70,
      statements: 70
    },
    './src/password-manager.js': {
      branches: 80,
      functions: 90,
      lines: 90,
      statements: 90
    },
    './src/crypto-manager.js': {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85
    }
  },

  // Module resolver
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1'
  },

  // Timeout
  testTimeout: 10000,

  // Verbose output
  verbose: true,

  // Stop on first test failure (optional, set to false to run all)
  bail: false,

  // Clear mocks between tests
  clearMocks: true,

  // Restore mocks between tests
  restoreMocks: true,

  // Transform files
  transform: {},

  // Module paths
  modulePaths: ['<rootDir>/src', '<rootDir>/'],

  // Test match ordering
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/'
  ],

  // Watch plugins
  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname'
  ]
};
