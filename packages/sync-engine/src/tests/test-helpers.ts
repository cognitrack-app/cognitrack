import { vi } from 'vitest';

// Export a factory that creates a rejected promise without triggering
// vitest's unhandled rejection detection at module load time.
export function createNetworkErrorRejection() {
  return Promise.reject(new Error('Network error'));
}
