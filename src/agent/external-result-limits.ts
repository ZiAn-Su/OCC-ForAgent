import { TOOL_ARTIFACT_THRESHOLD } from './runtime-ledger';

// load_skill already bounds and pages its own exact playbook result. The
// additional headroom covers activation metadata attached by MCP transport.
export const EXTERNAL_EXACT_SKILL_RESULT_LIMIT = 72_000;

export function externalResultLimit(toolName?: string): number {
  return toolName === 'load_skill'
    ? EXTERNAL_EXACT_SKILL_RESULT_LIMIT
    : TOOL_ARTIFACT_THRESHOLD;
}
