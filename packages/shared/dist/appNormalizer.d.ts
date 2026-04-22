import type { Category, Platform } from './types';
/**
 * Normalise a raw app/process name to a canonical cross-platform ID.
 * Caller provides the raw name from active-win (desktop) or UsageStats (Android).
 * Returns e.g. "win.chrome", "mac.vscode", "android.instagram".
 * Falls back to "<platform>.unknown.<sanitised-name>".
 */
export declare function normalizeAppId(rawName: string, platform: Platform): string;
/**
 * Map a canonical app ID to its cognitive category.
 * Defaults to 'tools' for unknown apps (browser-like default, not passive).
 */
export declare function resolveCategory(appId: string): Category;
//# sourceMappingURL=appNormalizer.d.ts.map