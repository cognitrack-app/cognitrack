// Simple test runner for sync engine
const { execSync } = require('child_process');

console.log('Running sync engine integration tests...');

try {
  // Build the package first
  execSync('npm run build', { cwd: './packages/sync-engine', stdio: 'inherit' });

  // Run tests
  execSync('npx vitest run packages/sync-engine/src/tests/sync.integration.test.ts', {
    cwd: './packages/sync-engine',
    stdio: 'inherit'
  });

  console.log('✅ All tests passed successfully!');
} catch (error) {
  console.error('❌ Tests failed:', error.message);
  process.exit(1);
}