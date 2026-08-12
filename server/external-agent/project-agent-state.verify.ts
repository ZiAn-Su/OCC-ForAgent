import assert from 'node:assert/strict';
import {
  parseRecoverableBrowserSession,
  parseRecoverableOfflineSession,
} from './project-agent-state.ts';

assert.deepEqual(parseRecoverableBrowserSession({
  sessionId: 'browser-session', status: 'drafting', approvalMode: 'auto',
  operationCount: 3, agentRunId: 'run-1', createdAt: 1,
  draftCheckpoint: { updatedAt: 2 },
}), {
  editSessionId: 'browser-session', status: 'drafting', bindingMode: 'browser',
  approvalMode: 'auto', operationCount: 3, agentRunId: 'run-1',
  updatedAt: new Date(2).toISOString(),
});
assert.equal(parseRecoverableBrowserSession({ sessionId: 'bad', status: 'applied' }), null);
assert.deepEqual(parseRecoverableOfflineSession({
  version: 1, sessionId: 'offline-session', approvalMode: 'auto',
  operations: [{}, {}], createdAt: 1, updatedAt: 3,
}), {
  editSessionId: 'offline-session', status: 'drafting', bindingMode: 'offline',
  approvalMode: 'auto', operationCount: 2, updatedAt: new Date(3).toISOString(),
});
assert.equal(parseRecoverableOfflineSession({ version: 2 }), null);

console.log('project agent recovery state verification passed');
