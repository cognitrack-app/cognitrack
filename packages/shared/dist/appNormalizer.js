"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeAppId = normalizeAppId;
exports.resolveCategory = resolveCategory;
// ─── Windows process name → canonical ID ───────────────────────────────────────
const WIN_APP_MAP = {
    'google chrome': 'win.chrome',
    'chrome': 'win.chrome',
    'microsoft edge': 'win.edge',
    'msedge': 'win.edge',
    'firefox': 'win.firefox',
    'brave': 'win.brave',
    'code': 'win.vscode',
    'visual studio code': 'win.vscode',
    'cursor': 'win.cursor',
    'webstorm': 'win.webstorm',
    'intellij idea': 'win.intellij',
    'pycharm': 'win.pycharm',
    'android studio': 'win.androidstudio',
    'windows terminal': 'win.terminal',
    'windowsterminal': 'win.terminal',
    'cmd': 'win.terminal',
    'powershell': 'win.terminal',
    'slack': 'win.slack',
    'discord': 'win.discord',
    'microsoft teams': 'win.teams',
    'teams': 'win.teams',
    'zoom': 'win.zoom',
    'notion': 'win.notion',
    'obsidian': 'win.obsidian',
    'spotify': 'win.spotify',
    'vlc media player': 'win.vlc',
    'netflix': 'win.netflix',
    'steam': 'win.steam',
    'explorer': 'win.explorer',
    'postman': 'win.postman',
    'docker desktop': 'win.docker',
    'figma': 'win.figma',
    'microsoft word': 'win.word',
    'microsoft excel': 'win.excel',
    'outlook': 'win.outlook',
};
// ─── macOS app name → canonical ID ─────────────────────────────────────────
const MAC_APP_MAP = {
    'google chrome': 'mac.chrome',
    'chrome': 'mac.chrome',
    'safari': 'mac.safari',
    'firefox': 'mac.firefox',
    'microsoft edge': 'mac.edge',
    'brave browser': 'mac.brave',
    'code': 'mac.vscode',
    'cursor': 'mac.cursor',
    'webstorm': 'mac.webstorm',
    'intellij idea': 'mac.intellij',
    'xcode': 'mac.xcode',
    'iterm2': 'mac.terminal',
    'terminal': 'mac.terminal',
    'warp': 'mac.terminal',
    'slack': 'mac.slack',
    'discord': 'mac.discord',
    'zoom': 'mac.zoom',
    'microsoft teams': 'mac.teams',
    'notion': 'mac.notion',
    'obsidian': 'mac.obsidian',
    'spotify': 'mac.spotify',
    'vlc': 'mac.vlc',
    'steam': 'mac.steam',
    'figma': 'mac.figma',
    'postman': 'mac.postman',
    'docker': 'mac.docker',
    'finder': 'mac.finder',
    'mail': 'mac.mail',
    'messages': 'mac.messages',
};
// ─── Category map (canonical ID → Category) ──────────────────────────────
const CATEGORY_MAP = {
    // — Productive (coding, writing, design)
    'win.vscode': 'productive',
    'win.cursor': 'productive',
    'win.webstorm': 'productive',
    'win.intellij': 'productive',
    'win.pycharm': 'productive',
    'win.androidstudio': 'productive',
    'win.figma': 'productive',
    'win.postman': 'productive',
    'win.notion': 'productive',
    'win.obsidian': 'productive',
    'win.word': 'productive',
    'win.excel': 'productive',
    'mac.vscode': 'productive',
    'mac.cursor': 'productive',
    'mac.webstorm': 'productive',
    'mac.intellij': 'productive',
    'mac.xcode': 'productive',
    'mac.figma': 'productive',
    'mac.postman': 'productive',
    'mac.notion': 'productive',
    'mac.obsidian': 'productive',
    // — Tools (browsers, communication, shell)
    'win.chrome': 'tools',
    'win.edge': 'tools',
    'win.firefox': 'tools',
    'win.brave': 'tools',
    'win.terminal': 'tools',
    'win.slack': 'tools',
    'win.teams': 'tools',
    'win.zoom': 'tools',
    'win.outlook': 'tools',
    'win.docker': 'tools',
    'win.explorer': 'tools',
    'mac.chrome': 'tools',
    'mac.safari': 'tools',
    'mac.firefox': 'tools',
    'mac.edge': 'tools',
    'mac.brave': 'tools',
    'mac.terminal': 'tools',
    'mac.slack': 'tools',
    'mac.teams': 'tools',
    'mac.zoom': 'tools',
    'mac.mail': 'tools',
    'mac.docker': 'tools',
    'mac.finder': 'tools',
    // — Entertainment
    'win.spotify': 'entertainment',
    'win.vlc': 'entertainment',
    'win.netflix': 'entertainment',
    'win.steam': 'entertainment',
    'mac.spotify': 'entertainment',
    'mac.vlc': 'entertainment',
    'mac.steam': 'entertainment',
    // — Social
    'win.discord': 'social',
    'mac.discord': 'social',
    'mac.messages': 'social',
};
// ─── Public API ─────────────────────────────────────────────────────────────────
/**
 * Normalise a raw app/process name to a canonical cross-platform ID.
 * Caller provides the raw name from active-win (desktop) or UsageStats (Android).
 * Returns e.g. "win.chrome", "mac.vscode", "android.instagram".
 * Falls back to "<platform>.unknown.<sanitised-name>".
 */
function normalizeAppId(rawName, platform) {
    const key = rawName.toLowerCase().trim();
    if (platform === 'win32') {
        return WIN_APP_MAP[key] ?? `win.unknown.${key.replace(/[^a-z0-9]/g, '')}`;
    }
    if (platform === 'darwin') {
        return MAC_APP_MAP[key] ?? `mac.unknown.${key.replace(/[^a-z0-9]/g, '')}`;
    }
    // Android: caller already passes package name; prefix with platform
    if (platform === 'android') {
        return `android.${key}`;
    }
    // iOS: caller passes bundle ID
    return `ios.${key}`;
}
/**
 * Map a canonical app ID to its cognitive category.
 * Defaults to 'tools' for unknown apps (browser-like default, not passive).
 */
function resolveCategory(appId) {
    return CATEGORY_MAP[appId] ?? 'tools';
}
