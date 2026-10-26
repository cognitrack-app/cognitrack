/**
 * cache.ts
 *
 * In-memory LRU cache + Firestore backup for 14-day rolling derived metrics.
 * Provides cache invalidation hook for runDerivedPass (ENG-11).
 *
 * Cache key includes userId and a version hash of the computation logic
 * to auto-invalidate on code changes.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

// ─── Configuration ─────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_ENTRIES = 1000;
const CACHE_COLLECTION = 'cache';
const CACHE_DOC_ID = 'derived14day';

// Version hash for auto-invalidation on code changes
// This is a hash of the derivations.ts file content - update when derivations logic changes
const COMPUTATION_VERSION = 'derivations-v1.3.0'; // Increment when derivations.ts logic changes

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CachedDerived {
  userId: string;
  version: string;
  cachedAt: Timestamp;
  last7Sessions: Array<{
    date: string;
    combinedLoad: number;
    combinedHourlyLoad: number[];
    phoneMetrics?: {
      hourlyLoad: number[];
      cognitiveLoadPct: number;
      categoryBreakdown: Record<string, number>;
      break_events: any[];
      totalSwitches: number;
      switchVelocityPeak: number;
      residueAtEOD: number;
      totalScreenTime: number;
      totalPickups: number;
      peakLoadHour: number;
    };
    desktopSessions?: Record<string, {
      hourlyLoad: number[];
      cognitiveLoadPct: number;
      categoryBreakdown: Record<string, number>;
      break_events: any[];
      totalSwitches: number;
      switchVelocityPeak: number;
      residueAtEOD: number;
      totalFocusedTime: number;
      peakLoadHour: number;
    }>;
    carryover_debt_pts?: number;
    carryover_residue?: number;
  }>;
  config: {
    cognitive_debt_critical_threshold: number;
    switch_baseline: number;
    switch_critical_threshold: number;
    sleep_target_hours: number;
    wake_hour: number;
  };
  oldestSessionDate: string; // For cache validity check
}

// ─── In-Memory LRU Cache ───────────────────────────────────────────────────────

interface CacheEntry {
  data: CachedDerived;
  timestamp: number;
  accessCount: number;
}

class LRUCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number = MAX_CACHE_ENTRIES, ttl: number = CACHE_TTL_MS) {
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  private makeKey(uid: string): string {
    return `${uid}:${COMPUTATION_VERSION}`;
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > this.ttl;
  }

  private evictIfNeeded(): void {
    if (this.cache.size >= this.maxSize) {
      // Find least recently used (lowest accessCount, then oldest timestamp)
      let lruKey: string | null = null;
      let lruScore = Infinity;

      for (const [key, entry] of this.cache.entries()) {
        const score = entry.accessCount * 1e12 + entry.timestamp;
        if (score < lruScore) {
          lruScore = score;
          lruKey = key;
        }
      }

      if (lruKey) {
        this.cache.delete(lruKey);
      }
    }
  }

  get(uid: string): CachedDerived | null {
    const key = this.makeKey(uid);
    const entry = this.cache.get(key);

    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return null;
    }

    entry.accessCount++;
    entry.timestamp = Date.now();
    return entry.data;
  }

  set(uid: string, data: CachedDerived): void {
    const key = this.makeKey(uid);
    this.evictIfNeeded();
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      accessCount: 1,
    });
  }

  invalidate(uid: string): void {
    const key = this.makeKey(uid);
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

// Global LRU cache instance
const lruCache = new LRUCache();

// ─── Firestore Backup ──────────────────────────────────────────────────────────

/**
 * Gets cached derived data from Firestore backup document.
 * Returns null if not found, expired, or version mismatch.
 */
export async function getDerivedCache(uid: string): Promise<CachedDerived | null> {
  // Check in-memory LRU first
  const memoryHit = lruCache.get(uid);
  if (memoryHit) {
    console.log(`📦 Cache HIT (memory) for uid=${uid}`);
    return memoryHit;
  }

  // Fall back to Firestore
  try {
    const db = getFirestore();
    const cacheRef = db
      .collection('users').doc(uid)
      .collection(CACHE_COLLECTION).doc(CACHE_DOC_ID);

    const snap = await cacheRef.get();
    if (!snap.exists) {
      console.log(`📦 Cache MISS (firestore) for uid=${uid}: document not found`);
      return null;
    }

    const data = snap.data() as CachedDerived;

    // Check version match for auto-invalidation on code changes
    if (data.version !== COMPUTATION_VERSION) {
      console.log(`📦 Cache INVALIDATED (version mismatch) for uid=${uid}: expected=${COMPUTATION_VERSION}, got=${data.version}`);
      await cacheRef.delete();
      return null;
    }

    // Check TTL
    const cachedAt = data.cachedAt?.toDate?.() ?? new Date(data.cachedAt as any);
    if (Date.now() - cachedAt.getTime() > CACHE_TTL_MS) {
      console.log(`📦 Cache EXPIRED (TTL) for uid=${uid}`);
      await cacheRef.delete();
      return null;
    }

    // Populate LRU for next access
    lruCache.set(uid, data);
    console.log(`📦 Cache HIT (firestore) for uid=${uid}`);
    return data;
  } catch (err) {
    console.error(`❌ Cache read error for uid=${uid}:`, err);
    return null;
  }
}

/**
 * Sets cached derived data in both LRU and Firestore backup.
 */
export async function setDerivedCache(uid: string, data: CachedDerived): Promise<void> {
  // Update in-memory LRU
  lruCache.set(uid, data);

  // Write to Firestore backup
  try {
    const db = getFirestore();
    const cacheRef = db
      .collection('users').doc(uid)
      .collection(CACHE_COLLECTION).doc(CACHE_DOC_ID);

    await cacheRef.set({
      ...data,
      cachedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`📦 Cache SET for uid=${uid} (memory + firestore)`);
  } catch (err) {
    console.error(`❌ Cache write error for uid=${uid}:`, err);
    // Don't throw - cache failure shouldn't block the merge
  }
}

/**
 * Invalidates cached derived data for a user (ENG-11).
 * Called after merge write and after weeklyRollup backfill.
 */
export async function invalidateDerivedCache(uid: string): Promise<void> {
  // Clear in-memory LRU
  lruCache.invalidate(uid);

  // Delete Firestore backup
  try {
    const db = getFirestore();
    const cacheRef = db
      .collection('users').doc(uid)
      .collection(CACHE_COLLECTION).doc(CACHE_DOC_ID);

    await cacheRef.delete();
    console.log(`📦 Cache INVALIDATED for uid=${uid}`);
  } catch (err) {
    // Ignore not-found errors, log others
    if ((err as any).code !== 'not-found') {
      console.error(`❌ Cache invalidation error for uid=${uid}:`, err);
    }
  }
}

/**
 * Checks if cache is valid for the given sessions (cache timestamp > oldest session).
 * Used by runDerivedPass to determine if cached context can be used.
 */
export function isCacheValidForSessions(
  cache: CachedDerived,
  last7Sessions: Array<{ date: string }>
): boolean {
  if (last7Sessions.length === 0) return true; // No sessions to compare against

  const oldestSessionDate = last7Sessions[last7Sessions.length - 1]?.date;
  if (!oldestSessionDate) return true;

  // Cache is valid if it was created after the oldest session in the context
  // This handles the case where new sessions were added since cache was built
  return cache.oldestSessionDate >= oldestSessionDate;
}