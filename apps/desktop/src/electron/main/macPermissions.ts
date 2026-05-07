import { systemPreferences, dialog, shell } from 'electron';

/**
 * macOS only — checks the Accessibility API permission required by active-win.
 *
 * Returns `true` immediately if:
 *   - Running on Windows (permission not required)
 *   - macOS Accessibility trust is already granted
 *
 * If not granted, shows a CogniTrack-branded dialog explaining the privacy
 * stance (only app name is read, never window title/URL), then opens the
 * correct System Settings pane. Returns `false` so the caller can delay
 * tracker start until the user relaunches with permission.
 *
 * @returns true if the tracker may start immediately, false otherwise.
 */
export async function ensureAccessibilityPermission(): Promise<boolean> {
  // Non-macOS: Accessibility API is not required — always OK to proceed.
  if (process.platform !== 'darwin') return true;

  // Pass `false` so we don't trigger the OS-native prompt here — we show
  // our own branded dialog below for a better user experience.
  const trusted = systemPreferences.isTrustedAccessibilityClient(false);
  if (trusted) return true;

  const { response } = await dialog.showMessageBox({
    type:      'info',
    title:     'CogniTrack needs Accessibility access',
    message:   'CogniTrack tracks your active window to measure cognitive load.',
    detail:
      'Only the app name is read — window titles and URLs are never accessed.\n\n' +
      'Please grant Accessibility access in System Settings, then relaunch CogniTrack.',
    buttons:   ['Open System Settings', 'Skip for now'],
    defaultId: 0,
    cancelId:  1,
  });

  if (response === 0) {
    // Deep-link directly to the Privacy & Security → Accessibility pane.
    // Works on macOS 13 Ventura+ (x-apple.systempreferences URL scheme).
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    );
  }

  // Return false — caller will not start the tracker.
  // User must relaunch after granting permission (macOS requires this).
  return false;
}
