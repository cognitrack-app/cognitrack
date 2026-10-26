import type { Platform } from '../types';

let isOnline = true;
const onlineListeners: ((online: boolean) => void)[] = [];

export function getOnlineStatus(): boolean {
  return isOnline;
}

export function onOnlineChange(cb: (online: boolean) => void): () => void {
  onlineListeners.push(cb);
  // Immediately call the existing listeners
  for (const listener of onlineListeners) {
    listener(isOnline);
  }
  // Return cleanup function
  return () => {
    const idx = onlineListeners.indexOf(cb);
    if (idx > -1) onlineListeners.splice(idx, 1);
  };
}

export function triggerOnlineChange(online: boolean): void {
  isOnline = online;
  for (const listener of onlineListeners) {
    listener(online);
  }
}
