import assert from 'node:assert/strict';
import { TOOL_ARTIFACT_THRESHOLD } from '../../src/agent/runtime-ledger.ts';
import {
  MCP_EXACT_SKILL_RESULT_LIMIT,
  projectMcpReply,
} from './mcp-result.ts';

const ordinaryLargeResult = { text: 'x'.repeat(TOOL_ARTIFACT_THRESHOLD + 1) };
assert.throws(
  () => projectMcpReply(ordinaryLargeResult),
  /too large and no recoverable artifact reference/,
  'ordinary oversized tool results must still require an artifact',
);

const boundedSkillResult = {
  skill: 'create-motion-graphics',
  file: 'SKILL.md',
  contents: { 'SKILL.md': 'x'.repeat(30_000) },
  nextOffset: null,
};
assert.deepEqual(
  projectMcpReply(boundedSkillResult, { exactSkillResult: true }),
  boundedSkillResult,
  'bounded load_skill results must pass through MCP exactly',
);

assert.throws(
  () => projectMcpReply(
    { text: 'x'.repeat(MCP_EXACT_SKILL_RESULT_LIMIT + 1) },
    { exactSkillResult: true },
  ),
  /Retry load_skill with file, offset, and a smaller limit/,
  'load_skill must retain a hard MCP result limit with paging guidance',
);

console.log('mcp result projection verification passed');
