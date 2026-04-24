import { initializeApp } from 'firebase-admin/app';
initializeApp();

export { mergeAgentData }         from './merge';
export { cleanupOldSessions }      from './cleanup';
export { registerDevice }          from './registerDevice';
export { weeklyRollup }            from './weeklyRollup';
export { initUser }                from './initUser';
export { calibrateBaselines }      from './calibrateBaselines';
export { seedProtocols }           from './seedProtocols';
export { dailyReset }         from './dailyReset';
export { logProtocolSession } from './logProtocolSession';
