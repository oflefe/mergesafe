module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  resolver: '<rootDir>/tests/jest-resolver.cjs',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  testRegex: '.*\\.spec\\.ts$',
  collectCoverageFrom: ['src/**/*.ts'],
};
