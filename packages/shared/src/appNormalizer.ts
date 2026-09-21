import type { Category, Platform } from './types';

// ─── Windows process name → canonical ID ───────────────────────────────────────
const WIN_APP_MAP: Record<string, string> = {
  'google chrome':    'win.chrome',
  'chrome':           'win.chrome',
  'microsoft edge':   'win.edge',
  'msedge':           'win.edge',
  'firefox':          'win.firefox',
  'brave':            'win.brave',
  'code':             'win.vscode',
  'visual studio code': 'win.vscode',
  'cursor':           'win.cursor',
  'webstorm':         'win.webstorm',
  'intellij idea':    'win.intellij',
  'pycharm':          'win.pycharm',
  'android studio':   'win.androidstudio',
  'windows terminal': 'win.terminal',
  'windowsterminal':  'win.terminal',
  'cmd':              'win.terminal',
  'powershell':       'win.terminal',
  'slack':            'win.slack',
  'discord':          'win.discord',
  'microsoft teams':  'win.teams',
  'teams':            'win.teams',
  'zoom':             'win.zoom',
  'notion':           'win.notion',
  'obsidian':         'win.obsidian',
  'spotify':          'win.spotify',
  'vlc media player': 'win.vlc',
  'netflix':          'win.netflix',
  'steam':            'win.steam',
  'explorer':         'win.explorer',
  'postman':          'win.postman',
  'docker desktop':   'win.docker',
  'figma':            'win.figma',
  'microsoft word':   'win.word',
  'microsoft excel':  'win.excel',
  // AI tools
  'windsurf':          'win.windsurf',
  'claude':            'win.claude',
  'chatgpt':           'win.chatgpt',
  // Password manager
  '1password':         'win.1password',
  '1password 7':       'win.1password',
};

// ─── macOS app name → canonical ID ─────────────────────────────────────────
const MAC_APP_MAP: Record<string, string> = {
  'google chrome':    'mac.chrome',
  'chrome':           'mac.chrome',
  'safari':           'mac.safari',
  'firefox':          'mac.firefox',
  'microsoft edge':   'mac.edge',
  'brave browser':    'mac.brave',
  'code':             'mac.vscode',
  'cursor':           'mac.cursor',
  'webstorm':         'mac.webstorm',
  'intellij idea':    'mac.intellij',
  'xcode':            'mac.xcode',
  'iterm2':           'mac.terminal',
  'terminal':         'mac.terminal',
  'warp':             'mac.terminal',
  'slack':            'mac.slack',
  'discord':          'mac.discord',
  'zoom':             'mac.zoom',
  'microsoft teams':  'mac.teams',
  'notion':           'mac.notion',
  'obsidian':         'mac.obsidian',
  'spotify':          'mac.spotify',
  'vlc':              'mac.vlc',
  'steam':            'mac.steam',
  'figma':            'mac.figma',
  'postman':          'mac.postman',
  'docker':           'mac.docker',
  'finder':           'mac.finder',
  'mail':             'mac.mail',
  'messages':         'mac.messages',
  // IDEs present in WIN_APP_MAP but missing from MAC_APP_MAP
  'pycharm':          'mac.pycharm',
  'android studio':   'mac.androidstudio',
  // macOS-specific browser
  'arc':              'mac.arc',
  // AI tools
  'windsurf':         'mac.windsurf',
  'claude':           'mac.claude',
  'chatgpt':          'mac.chatgpt',
  // Productivity / project management
  'linear':           'mac.linear',
  // Password manager
  '1password':        'mac.1password',
  '1password 7':      'mac.1password',
};

// ─── Android package name → canonical ID ───────────────────────────────────────
// MUST match Dart _androidAppMap in app_normalizer.dart
const ANDROID_APP_MAP: Record<string, string> = {
  // Browsers
  'com.android.chrome': 'android.chrome',
  'com.google.android.apps.chrome': 'android.chrome',
  'org.mozilla.firefox': 'android.firefox',
  'com.brave.browser': 'android.brave',
  'com.microsoft.emmx': 'android.edge',
  'com.microsoft.edgemobile': 'android.edge',

  // Development / Productive
  'com.microsoft.vscode': 'android.vscode',
  'com.jetbrains.pycharm': 'android.pycharm',
  'com.google.android.studio': 'android.androidstudio',

  // Communication (Tools)
  'com.slack': 'android.slack',
  'com.discord': 'android.discord',
  'com.microsoft.teams': 'android.teams',
  'us.zoom.videomeetings': 'android.zoom',
  'com.whatsapp': 'android.whatsapp',
  'com.google.android.gm': 'android.gmail',
  'com.microsoft.office.outlook': 'android.msoutlook',

  // Terminal / Shell (Tools)
  'com.termux': 'android.terminal',
  'jackpal.androidterm': 'android.terminal',

  // Utilities (Tools)
  'com.docker.android': 'android.docker',
  'com.agilebits.onepassword': 'android.1password',
  'com.google.android.apps.photos': 'android.photos',
  'com.google.android.apps.maps': 'android.googlemaps',

  // Social
  'com.instagram.android': 'android.instagram',
  'com.facebook.katana': 'android.facebook',
  'com.twitter.android': 'android.twitter',
  'com.reddit.frontpage': 'android.reddit',
  'com.snapchat.android': 'android.snapchat',

  // Entertainment
  'com.spotify.music': 'android.spotify',
  'com.netflix.mediaclient': 'android.netflix',
  'com.google.android.youtube': 'android.youtube',
  'com.valvesoftware.android.steam.community': 'android.steam',

  // Passive Waste (short-form infinite scroll)
  'com.zhiliaoapp.musically': 'android.tiktok',
  'com.ss.android.ugc.trill': 'android.tiktok',
};

// ─── iOS bundle ID → canonical ID ───────────────────────────────────────────
// MUST match Dart _iosAppMap in app_normalizer.dart
const IOS_APP_MAP: Record<string, string> = {
  // Browsers
  'com.google.chrome.ios': 'ios.chrome',
  'org.mozilla.ios.firefox': 'ios.firefox',
  'com.brave.ios.browser': 'ios.brave',
  'com.microsoft.msedge': 'ios.edge',
  'com.apple.mobilesafari': 'ios.safari',

  // Development / Productive
  'com.microsoft.vscode': 'ios.vscode',
  'com.jetbrains.pycharm': 'ios.pycharm',
  'com.apple.dt.Xcode': 'ios.xcode',

  // Communication (Tools)
  'com.tinyspeck.chatlyio': 'ios.slack',
  'com.microsoft.teams': 'ios.teams',
  'us.zoom.videomeetings': 'ios.zoom',
  'net.whatsapp.whatsapp': 'ios.whatsapp',
  'com.apple.mobilemail': 'ios.mail',
  'com.microsoft.outlook': 'ios.msoutlook',

  // Terminal / Shell (Tools)
  'com.termux.ios': 'ios.terminal',
  'com.google.android.apps.terminal': 'ios.terminal',

  // Utilities (Tools)
  'com.docker.docker': 'ios.docker',
  'com.agilebits.onepassword': 'ios.1password',
  'com.apple.photos': 'ios.photos',
  'com.apple.maps': 'ios.maps',
  'com.apple.preferences': 'ios.settings',

  // Social
  'com.burbn.instagram': 'ios.instagram',
  'com.facebook.facebook': 'ios.facebook',
  'com.atebits.tweetie2': 'ios.twitter',
  'com.reddit.reddit': 'ios.reddit',
  'com.toyopagroup.picaboo': 'ios.snapchat',
  'com.hammerandchisel.discord': 'ios.discord',
  'com.apple.mobilesms': 'ios.messages',

  // Entertainment
  'com.spotify.client': 'ios.spotify',
  'com.netflix.netflix': 'ios.netflix',
  'com.google.ios.youtube': 'ios.youtube',
  'com.valvesoftware.steam': 'ios.steam',

  // Passive Waste
  'com.zhiliaoapp.musically': 'ios.tiktok',
};

// ─── Category map (canonical ID → Category) ──────────────────────────────
// MUST match Dart _categoryMap in app_normalizer.dart for cross-platform parity
const CATEGORY_MAP: Record<string, Category> = {
  // — Productive (coding, writing, design)
  'win.vscode':         'productive',
  'win.cursor':         'productive',
  'win.webstorm':       'productive',
  'win.intellij':       'productive',
  'win.pycharm':        'productive',
  'win.androidstudio':  'productive',
  'win.figma':          'productive',
  'win.postman':        'productive',
  'win.notion':         'productive',
  'win.obsidian':       'productive',
  'win.word':           'productive',
  'win.excel':          'productive',
  'win.windsurf':       'productive',
  'mac.vscode':         'productive',
  'mac.cursor':         'productive',
  'mac.webstorm':       'productive',
  'mac.intellij':       'productive',
  'mac.xcode':          'productive',
  'mac.figma':          'productive',
  'mac.postman':        'productive',
  'mac.notion':         'productive',
  'mac.obsidian':       'productive',
  'mac.pycharm':        'productive',
  'mac.androidstudio':  'productive',
  'mac.windsurf':       'productive',
  'mac.linear':         'productive',
  'android.vscode':     'productive',
  'android.pycharm':    'productive',
  'android.androidstudio': 'productive',
  'ios.vscode':         'productive',
  'ios.pycharm':        'productive',
  'ios.xcode':          'productive',

  // — Tools (browsers, communication, shell, AI assistants, utilities)
  'win.chrome':         'tools',
  'win.edge':           'tools',
  'win.firefox':        'tools',
  'win.brave':          'tools',
  'win.terminal':       'tools',
  'win.slack':          'tools',
  'win.teams':          'tools',
  'win.zoom':           'tools',
  'win.outlook':        'tools',
  'win.docker':         'tools',
  'win.explorer':       'tools',
  'win.claude':         'tools',
  'win.chatgpt':        'tools',
  'win.1password':      'tools',
  'mac.chrome':         'tools',
  'mac.safari':         'tools',
  'mac.firefox':        'tools',
  'mac.edge':           'tools',
  'mac.brave':          'tools',
  'mac.arc':            'tools',
  'mac.terminal':       'tools',
  'mac.slack':          'tools',
  'mac.teams':          'tools',
  'mac.zoom':           'tools',
  'mac.mail':           'tools',
  'mac.docker':         'tools',
  'mac.finder':         'tools',
  'mac.claude':         'tools',
  'mac.chatgpt':        'tools',
  'mac.1password':      'tools',
  'android.chrome':     'tools',
  'android.firefox':    'tools',
  'android.brave':      'tools',
  'android.edge':       'tools',
  'android.gmail':      'tools',
  'android.msoutlook':  'tools',
  'android.slack':      'tools',
  'android.teams':      'tools',
  'android.zoom':       'tools',
  'android.whatsapp':   'tools',
  'android.terminal':   'tools',
  'android.docker':     'tools',
  'android.1password':  'tools',
  'android.photos':     'tools',
  'android.googlemaps': 'tools',
  'ios.chrome':         'tools',
  'ios.safari':         'tools',
  'ios.firefox':        'tools',
  'ios.brave':          'tools',
  'ios.edge':           'tools',
  'ios.mail':           'tools',
  'ios.msoutlook':      'tools',
  'ios.slack':          'tools',
  'ios.teams':          'tools',
  'ios.zoom':           'tools',
  'ios.whatsapp':       'tools',
  'ios.messages':       'tools',
  'ios.terminal':       'tools',
  'ios.docker':         'tools',
  'ios.1password':      'tools',
  'ios.photos':         'tools',
  'ios.maps':           'tools',
  'ios.settings':       'tools',

  // — Entertainment
  'win.spotify':        'entertainment',
  'win.vlc':            'entertainment',
  'win.netflix':        'entertainment',
  'win.steam':          'entertainment',
  'mac.spotify':        'entertainment',
  'mac.vlc':            'entertainment',
  'mac.steam':          'entertainment',
  'android.spotify':    'entertainment',
  'android.netflix':    'entertainment',
  'android.youtube':    'entertainment',
  'android.steam':      'entertainment',
  'ios.spotify':        'entertainment',
  'ios.netflix':        'entertainment',
  'ios.youtube':        'entertainment',
  'ios.steam':          'entertainment',

  // — Social
  'win.discord':        'social',
  'mac.discord':        'social',
  'mac.messages':       'social',
  'android.instagram':  'social',
  'android.facebook':   'social',
  'android.twitter':    'social',
  'android.reddit':     'social',
  'android.snapchat':   'social',
  'android.discord':    'social',
  'ios.instagram':      'social',
  'ios.facebook':       'social',
  'ios.twitter':        'social',
  'ios.reddit':         'social',
  'ios.snapchat':       'social',
  'ios.discord':        'social',

  // — Passive Waste (short-form infinite scroll)
  'android.tiktok':     'passiveWaste',
  'ios.tiktok':         'passiveWaste',
};

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Normalise a raw app/process name to a canonical cross-platform ID.
 * Caller provides the raw name from active-win (desktop) or UsageStats (Android).
 * Returns e.g. "win.chrome", "mac.vscode", "android.instagram", "ios.safari".
 * Falls back to "<platform>.unknown.<sanitised-name>".
 */
export function normalizeAppId(rawName: string, platform: Platform): string {
  const key = rawName.toLowerCase().trim();

  if (platform === 'win32') {
    return WIN_APP_MAP[key] ?? `win.unknown.${key.replace(/[^a-z0-9]/g, '')}`;
  }
  if (platform === 'darwin') {
    return MAC_APP_MAP[key] ?? `mac.unknown.${key.replace(/[^a-z0-9]/g, '')}`;
  }
  // Android: caller passes package name; map to canonical ID
  if (platform === 'android') {
    return ANDROID_APP_MAP[key] ?? `android.unknown.${key.replace(/[^a-z0-9]/g, '')}`;
  }
  // iOS: caller passes bundle ID; map to canonical ID
  return IOS_APP_MAP[key] ?? `ios.unknown.${key.replace(/[^a-z0-9]/g, '')}`;
}

/**
 * Map a canonical app ID to its cognitive category.
 * Defaults to 'tools' for unknown apps (browser-like default, not passive).
 */
export function resolveCategory(appId: string): Category {
  return CATEGORY_MAP[appId] ?? 'tools';
}