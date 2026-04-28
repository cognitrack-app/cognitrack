import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * cleanupOldSessions
 *
 * Runs daily at 02:00 UTC.
 * Deletes session AND derived documents older than 365 days across all users.
 * Uses Firestore batched writes (max 499 per batch) to stay within limits.
 *
 * CLOUD-01 FIX: The previous version only deleted /sessions/{date} documents.
 * Each session has a matching /derived/{date} document written by merge.ts.
 * Without cleaning derived docs, they accumulate permanently (~365/user/year)
 * increasing Firestore storage costs and degrading query performance on the
 * derived collection over time.
 */
export const cleanupOldSessions = onSchedule(
  { schedule: '0 2 * * *', timeZone: 'UTC' },
  async () => {
    const db = getFirestore();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 365);
    const cutoffStr = cutoffDate.toISOString().split('T')[0]!;

    const usersSnap = await db.collection('users').get();
    let totalDeletedSessions = 0;
    let totalDeletedDerived = 0;

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;

      // ── Delete old session documents ──────────────────────────────────────
      const sessionsRef = db
        .collection('users')
        .doc(uid)
        .collection('sessions');

      const oldSessionsSnap = await sessionsRef
        .where('date', '<', cutoffStr)
        .get();

      if (!oldSessionsSnap.empty) {
        for (let i = 0; i < oldSessionsSnap.docs.length; i += 499) {
          const chunk = oldSessionsSnap.docs.slice(i, i + 499);
          const batch = db.batch();
          chunk.forEach((doc) => batch.delete(doc.ref));
          await batch.commit();
          totalDeletedSessions += chunk.length;
        }
      }

      // ── CLOUD-01 FIX: Also delete matching /derived/{date} documents ───────
      // merge.ts writes a /derived/{date} document for every /sessions/{date}.
      // Without this, derived documents accumulate permanently and are never
      // pruned, growing by ~365 documents per user per year.
      const derivedRef = db
        .collection('users')
        .doc(uid)
        .collection('derived');

      const oldDerivedSnap = await derivedRef
        .where('date', '<', cutoffStr)
        .get();

      if (!oldDerivedSnap.empty) {
        for (let i = 0; i < oldDerivedSnap.docs.length; i += 499) {
          const chunk = oldDerivedSnap.docs.slice(i, i + 499);
          const batch = db.batch();
          chunk.forEach((doc) => batch.delete(doc.ref));
          await batch.commit();
          totalDeletedDerived += chunk.length;
        }
      }
    }

    console.log(
      `✅ Cleanup complete: deleted ${totalDeletedSessions} sessions and ` +
      `${totalDeletedDerived} derived docs older than ${cutoffStr}`
    );
  }
);
