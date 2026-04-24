/**
 * logProtocolSession.ts
 *
 * Callable Cloud Function — client calls this when:
 *   1. User taps Play on a Sanctuary protocol (status: 'STARTED')
 *   2. Protocol timer completes naturally    (status: 'COMPLETED')
 *   3. User exits early                      (status: 'ABANDONED')
 *
 * Writes to: /users/{uid}/protocol_sessions/{sessionId}
 *
 * Also updates the parent session doc's break_events array (merge) so
 * that the Recovery Coefficient chart reflects protocol completions
 * alongside idle-gap breaks detected by batchProcessor.ts.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { BreakEvent } from '@cognitrack/shared';

interface LogProtocolSessionRequest {
  protocol_id:            string;
  protocol_name:          string;
  status:                 'STARTED' | 'COMPLETED' | 'ABANDONED';
  duration_completed_sec: number;   // seconds actually spent (< full duration if abandoned)
  debt_before:            number;   // cognitive debt % at tap time — client sends this
  date:                   string;   // YYYY-MM-DD
}

export const logProtocolSession = onCall(
  { enforceAppCheck: false },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const data = request.data as LogProtocolSessionRequest;

    // Validate required fields
    if (!data.protocol_id || !data.status || !data.date) {
      throw new HttpsError('invalid-argument', 'protocol_id, status, and date are required.');
    }

    const db = getFirestore();
    const now = new Date().toISOString();
    const durationMinutes = Math.round(data.duration_completed_sec / 60);

    // ── Write protocol session record ────────────────────────────────────────
    const sessionRef = db
      .collection('users').doc(uid)
      .collection('protocol_sessions')
      .doc(); // auto-ID

    await sessionRef.set({
      protocol_id:            data.protocol_id,
      protocol_name:          data.protocol_name,
      status:                 data.status,
      duration_completed_sec: data.duration_completed_sec,
      debt_before:            data.debt_before,
      date:                   data.date,
      created_at:             now,
    });

    // ── If COMPLETED, also inject a BreakEvent into today's session doc ──────
    // This ensures the Recovery Coefficient chart reflects protocol completions
    // alongside idle-gap breaks from batchProcessor.
    if (data.status === 'COMPLETED' && durationMinutes >= 4) {
      // Estimate debt_after: structured protocols typically reduce load 8–15%
      // We use a conservative 10% drop. Real debt_after will be overwritten
      // on the next agent sync (batchProcessor re-runs every 30 min).
      const estimatedDebtAfter = Math.max(0, data.debt_before - 10);
      const ptsRecovered       = data.debt_before - estimatedDebtAfter;
      const efficiencyPct      = data.debt_before === 0
        ? 0
        : Math.round((ptsRecovered / data.debt_before) * 100);

      const breakEvent: BreakEvent = {
        start_time:       now,
        end_time:         new Date(Date.now() + data.duration_completed_sec * 1000).toISOString(),
        activity_type:    'STRUCTURED',
        duration_minutes: durationMinutes,
        debt_before:      data.debt_before,
        debt_after:       estimatedDebtAfter,
        pts_recovered:    ptsRecovered,
        efficiency_pct:   efficiencyPct,
      };

      // Merge into /sessions/{date}.phoneMetrics.break_events
      // (phone is used as the canonical break event source for the
      // derivations pipeline — desktop breaks are merged in derivations.ts)
      await db
        .collection('users').doc(uid)
        .collection('sessions').doc(data.date)
        .set(
          {
            phoneMetrics: {
              break_events: FieldValue.arrayUnion(breakEvent),
            },
          },
          { merge: true }
        );
    }

    return { success: true, session_id: sessionRef.id };
  }
);
