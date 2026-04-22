/**
 * seedProtocols.ts
 *
 * One-shot callable Cloud Function.
 * Seeds the /protocols collection with the 9 Sanctuary protocols.
 * Safe to call multiple times — uses set({ merge: true }).
 *
 * Call from Firebase console, CLI, or the app during admin setup:
 *   firebase functions:call seedProtocols
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import type { Protocol } from '@cognitrack/shared';

const PROTOCOLS: Protocol[] = [
  {
    id: 'box-breathing',
    name: 'Box Breathing',
    duration_sec: 240,
    category: 'BREATHING',
    tags: ['Focus', 'Stress'],
    tier_activation: 0,
    description: '4-4-4-4 breath pattern. Activates parasympathetic nervous system within 3 cycles.',
  },
  {
    id: '4-7-8-reset',
    name: '4-7-8 Reset',
    duration_sec: 300,
    category: 'BREATHING',
    tags: ['Sleep', 'Calm'],
    tier_activation: 1,
    description: 'Inhale 4s, hold 7s, exhale 8s. Deep sleep preparation.',
  },
  {
    id: '20-20-20-protocol',
    name: '20-20-20 Protocol',
    duration_sec: 60,
    category: 'EYE_RELIEF',
    tags: ['Eye Strain', 'Focus'],
    tier_activation: 0,
    description: 'Every 20 min, look at something 20 feet away for 20 seconds.',
  },
  {
    id: 'palming-session',
    name: 'Palming Session',
    duration_sec: 180,
    category: 'EYE_RELIEF',
    tags: ['Eye Strain', 'Decompress'],
    tier_activation: 1,
    description: 'Warm palm coverage over closed eyes. Reduces ciliary muscle tension.',
  },
  {
    id: 'neural-drift',
    name: 'Neural Drift',
    duration_sec: 600,
    category: 'MEDITATION',
    tags: ['Focus', 'Deep Work'],
    tier_activation: 0,
    description: 'Theta wave tuning (4–8 Hz binaural). Enhances cross-cortical synchronisation.',
  },
  {
    id: 'gamma-sync',
    name: 'Gamma Sync',
    duration_sec: 600,
    category: 'MEDITATION',
    tags: ['Cognitive Alignment', 'Performance'],
    tier_activation: 1,
    description: 'Gamma frequency (40 Hz) neural entrainment for cognitive clarity.',
  },
  {
    id: 'white-noise',
    name: 'White Noise',
    duration_sec: 600,
    category: 'MEDITATION',
    tags: ['Neural Masking', 'Focus'],
    tier_activation: 0,
    description: 'Broadband noise masking for reduced neural distraction.',
  },
  {
    id: 'river-stream',
    name: 'River / Stream',
    duration_sec: 600,
    category: 'NATURE_SOUND',
    tags: ['Aqueous Ambient', 'Recovery'],
    tier_activation: 0,
    description: 'Flowing water biophilic audio. Proven to lower cortisol within 4 minutes.',
  },
  {
    id: 'zen-forest',
    name: 'Zen Forest',
    duration_sec: 600,
    category: 'NATURE_SOUND',
    tags: ['Biophilic Rest', 'Sleep'],
    tier_activation: 2,
    description: 'Forest ambience with bird calls. Activates default mode network recovery.',
  },
];

export const seedProtocols = onCall(
  { enforceAppCheck: false },
  async (request) => {
    // Restrict to authenticated users only — add admin role check for production
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Login required');
    }

    const db = getFirestore();
    const batch = db.batch();

    for (const protocol of PROTOCOLS) {
      const ref = db.collection('protocols').doc(protocol.id);
      batch.set(ref, protocol, { merge: true });
    }

    await batch.commit();
    console.log(`✅ Seeded ${PROTOCOLS.length} protocols`);
    return { success: true, count: PROTOCOLS.length };
  }
);
