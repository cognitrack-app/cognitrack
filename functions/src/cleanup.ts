import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * cleanupOldSessions
 *
 * Runs daily at 02:00 UTC.
 * Deletes session documents older than 365 days across all users.
 * Uses Firestore batched writes (max 499 per batch) to stay within limits.
 */
export const cleanupOldSessions = onSchedule(
  { schedule: '0 2 * * *', timeZone: 'UTC' },
  async () => {
    const db = getFirestore();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 365);
    const cutoffStr = cutoffDate.toISOString().split('T')[0]!;

    const usersSnap = await db.collection('users').get();
    let totalDeleted = 0;

    for (const userDoc of usersSnap.docs) {
      const sessionsRef = db
        .collection('users')
        .doc(userDoc.id)
        .collection('sessions');

      const oldSessionsSnap = await sessionsRef
        .where('date', '<', cutoffStr)
        .get();

      if (oldSessionsSnap.empty) continue;

      // Batched delete — Firestore limit is 500 per batch
      for (let i = 0; i < oldSessionsSnap.docs.length; i += 499) {
        const chunk = oldSessionsSnap.docs.slice(i, i + 499);
        const batch = db.batch();
        chunk.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        totalDeleted += chunk.length;
      }
    }

    console.log(
      `✅ Cleanup complete: deleted ${totalDeleted} sessions older than ${cutoffStr}`
    );
  }
);
