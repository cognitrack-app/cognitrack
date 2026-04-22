import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const CACHE_FILE = 'device-id.txt';

/**
 * Returns a stable, anonymised device identifier for this Windows machine.
 *
 * Strategy:
 *   1. Read from userData cache (fastest path — avoids shelling out on every launch)
 *   2. Shell out to `wmic csproduct get UUID` to retrieve the hardware GUID
 *   3. SHA-256 hash the GUID so the raw hardware ID never leaves the machine
 *   4. Persist the hash to userData so step 2 only ever runs once
 *
 * The resulting ID is 32 hex chars — irreversible, no PII.
 * Matches the v6 PRD: "SHA-256(Windows GUID)".
 */
export function getWindowsDeviceId(): string {
  const cachePath = path.join(app.getPath('userData'), CACHE_FILE);

  // Fast path: already computed on a previous launch
  if (fs.existsSync(cachePath)) {
    const cached = fs.readFileSync(cachePath, 'utf-8').trim();
    if (cached.length === 64) return cached; // valid SHA-256 hex
  }

  const deviceId = computeDeviceId();
  // Persist so wmic is never called again
  try {
    fs.writeFileSync(cachePath, deviceId, { encoding: 'utf-8' });
  } catch (err) {
    // Non-fatal: we still return the freshly computed ID this session
    console.warn('[deviceId] Could not persist device ID cache:', err);
  }

  return deviceId;
}

function computeDeviceId(): string {
  try {
    if (process.platform === 'darwin') {
      const raw = execSync("system_profiler SPHardwareDataType | awk '/Hardware UUID/ {print $3}'", { encoding: 'utf-8', timeout: 3000 });
      return createHash('sha256').update(raw.trim()).digest('hex');
    }

    // The modern way to get the hardware GUID on Windows is via PowerShell WMI.
    // 'wmic' is deprecated and removed from some Windows 11 builds.
    const raw = execSync(
      'powershell -NoProfile -Command "(Get-WmiObject Win32_ComputerSystemProduct).UUID"',
      { encoding: 'utf-8', timeout: 4000, windowsHide: true }
    );

    const guid = raw.trim();

    if (guid && guid !== 'To Be Filled By O.E.M.' && guid.length > 8) {
      return createHash('sha256').update(guid).digest('hex');
    }

    // GUID was invalid or a placeholder — fall through to random ID
    console.warn('[deviceId] wmic returned an invalid UUID, using stable random fallback');
  } catch (err) {
    // wmic not available or timed out (rare on modern Windows)
    console.warn('[deviceId] wmic failed:', err);
  }

  return generateStableFallbackId();
}

/**
 * Generates a stable random ID and persists it so it survives restarts.
 * Only used when wmic is unavailable or returns a placeholder GUID.
 */
function generateStableFallbackId(): string {
  const { randomBytes } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(randomBytes(32)).digest('hex');
}
