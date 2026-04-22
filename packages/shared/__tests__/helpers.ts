/**
 * Shared test factory helpers.
 * All test files import from here so event shapes stay in sync with AppEvent.
 */
import type { AppEvent, Category, DeviceType } from '../src/types';

let _seq = 0;

export function makeEvent(overrides: Partial<AppEvent> = {}): AppEvent {
  return {
    id: `test-event-${++_seq}`,
    timestamp: 0,
    appId: 'test.app',
    category: 'productive',
    durationMs: 1000,
    eventType: 'switch',
    deviceType: 'desktop',
    ...overrides,
  };
}

export function makeSwitch(
  timestamp: number,
  category: Category,
  deviceType: DeviceType = 'desktop'
): AppEvent {
  return makeEvent({ timestamp, category, eventType: 'switch', deviceType });
}

export function makeBreak(timestamp: number): AppEvent {
  return makeEvent({ timestamp, category: 'entertainment', eventType: 'break' });
}

export function makePickup(timestamp: number, category: Category): AppEvent {
  return makeEvent({ timestamp, category, eventType: 'pickup', deviceType: 'phone' });
}

export function makeIdle(timestamp: number): AppEvent {
  return makeEvent({ timestamp, category: 'productive', eventType: 'idle' });
}
