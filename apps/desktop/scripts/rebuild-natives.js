/**
 * Rebuild native modules (better-sqlite3, active-win) against
 * the Electron version. Called by electron-builder before packaging.
 */
const { execSync } = require('child_process');
const path = require('path');

const electronPath = path.resolve(__dirname, '../node_modules/.bin/electron');

try {
  console.log('[rebuild] Rebuilding native modules for Electron...');
  execSync('node_modules/.bin/electron-rebuild -f -w better-sqlite3,active-win', {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
  });
  console.log('[rebuild] Done.');
} catch (err) {
  console.error('[rebuild] Failed:', err.message);
  process.exit(1);
}
