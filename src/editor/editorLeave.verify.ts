import assert from 'node:assert/strict';
import { leaveEditor } from './editorLeave.ts';

let leaves = 0;
let confirmations = 0;
assert.equal(await leaveEditor({
  flush: async () => true,
  confirmDiscard: () => { confirmations += 1; return false; },
  leave: () => { leaves += 1; },
}), 'saved');
assert.equal(leaves, 1);
assert.equal(confirmations, 0);

assert.equal(await leaveEditor({
  flush: async () => false,
  confirmDiscard: () => { confirmations += 1; return false; },
  leave: () => { leaves += 1; },
}), 'cancelled');
assert.equal(leaves, 1);
assert.equal(confirmations, 1);

assert.equal(await leaveEditor({
  flush: async () => false,
  confirmDiscard: () => { confirmations += 1; return true; },
  leave: () => { leaves += 1; },
}), 'discarded');
assert.equal(leaves, 2);
assert.equal(confirmations, 2);

console.log('editor leave verification passed');
