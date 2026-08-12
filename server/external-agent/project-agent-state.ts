import { getStoredEntry } from '../plugins/project-store.ts';

type ActiveSessionStatus = 'drafting' | 'awaiting_review';

export interface RecoverableProjectEditSession {
  readonly editSessionId: string;
  readonly status: ActiveSessionStatus;
  readonly bindingMode: 'browser' | 'offline';
  readonly approvalMode: 'manual' | 'auto';
  readonly operationCount: number;
  readonly agentRunId?: string;
  readonly updatedAt: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteTime(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function activeStatus(value: unknown): value is ActiveSessionStatus {
  return value === 'drafting' || value === 'awaiting_review';
}

function commonSession(
  value: Record<string, unknown>,
  bindingMode: RecoverableProjectEditSession['bindingMode'],
  updatedAt: number | null,
): RecoverableProjectEditSession | null {
  if (typeof value.sessionId !== 'string' || !value.sessionId.trim() || !activeStatus(value.status)) return null;
  const operationCount = typeof value.operationCount === 'number'
    && Number.isInteger(value.operationCount) && value.operationCount >= 0
    ? value.operationCount
    : 0;
  const createdAt = finiteTime(value.createdAt);
  if (updatedAt === null && createdAt === null) return null;
  return {
    editSessionId: value.sessionId.trim(),
    status: value.status,
    bindingMode,
    approvalMode: value.approvalMode === 'auto' ? 'auto' : 'manual',
    operationCount,
    ...(typeof value.agentRunId === 'string' && value.agentRunId
      ? { agentRunId: value.agentRunId } : {}),
    updatedAt: new Date(updatedAt ?? createdAt!).toISOString(),
  };
}

export function parseRecoverableBrowserSession(value: unknown): RecoverableProjectEditSession | null {
  const stored = record(value);
  if (!stored) return null;
  const checkpoint = record(stored.draftCheckpoint);
  return commonSession(stored, 'browser', finiteTime(checkpoint?.updatedAt));
}

export function parseRecoverableOfflineSession(value: unknown): RecoverableProjectEditSession | null {
  const checkpoint = record(value);
  if (!checkpoint || checkpoint.version !== 1) return null;
  return commonSession(
    { ...checkpoint, status: 'drafting', operationCount: Array.isArray(checkpoint.operations) ? checkpoint.operations.length : 0 },
    'offline',
    finiteTime(checkpoint.updatedAt),
  );
}

/**
 * Persistent recovery index for agents. Browser drafts and offline drafts use
 * different execution engines today, but this project-level view deliberately
 * gives MCP one stable way to discover either after a client restart.
 */
export async function getProjectAgentState(projectId: string): Promise<{
  projectId: string;
  activeEditSession: RecoverableProjectEditSession | null;
}> {
  const [browser, offline] = await Promise.all([
    getStoredEntry(`external-proposal:${projectId}`),
    getStoredEntry(`offline-edit-session:${projectId}`),
  ]);
  return {
    projectId,
    activeEditSession: parseRecoverableBrowserSession(browser.value)
      ?? parseRecoverableOfflineSession(offline.value),
  };
}
