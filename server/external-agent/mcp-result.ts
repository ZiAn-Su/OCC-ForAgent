import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  redactTextForAgentRuntime,
  sanitizeJsonForArtifact,
} from '../../src/agent/runtime-artifact.ts';
import { TOOL_ARTIFACT_THRESHOLD } from '../../src/agent/runtime-ledger.ts';
import { EXTERNAL_EXACT_SKILL_RESULT_LIMIT } from '../../src/agent/external-result-limits.ts';
import { ExternalEditorCallError } from './broker.ts';

interface EmbeddedImage {
  base64: string;
  frame?: number;
  mimeType?: string;
}

// load_skill already enforces a 64k character result budget and pages larger
// playbooks with file/offset/nextOffset. Keep that exact, recoverable protocol
// intact instead of treating a valid skill page as an unarchived tool result.
// The extra headroom covers MCP activation metadata appended after the tool call.
export const MCP_EXACT_SKILL_RESULT_LIMIT = EXTERNAL_EXACT_SKILL_RESULT_LIMIT;

interface McpReplyProjectionOptions {
  exactSkillResult?: boolean;
}

function embeddedImages(result: unknown): EmbeddedImage[] {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
  if (!('__images' in result)) return [];
  const images = result.__images;
  if (!Array.isArray(images)) return [];
  return images.filter((image): image is EmbeddedImage => (
    image !== null
    && typeof image === 'object'
    && 'base64' in image
    && typeof image.base64 === 'string'
  ));
}

export function projectMcpReply(
  value: unknown,
  options: McpReplyProjectionOptions = {},
): unknown {
  const sanitized = sanitizeJsonForArtifact(value);
  if (!sanitized) {
    throw new ExternalEditorCallError(
      'failed',
      'The external result could not be serialized safely.',
    );
  }
  const resultLimit = options.exactSkillResult
    ? MCP_EXACT_SKILL_RESULT_LIMIT
    : TOOL_ARTIFACT_THRESHOLD;
  if (sanitized.originalChars > resultLimit) {
    throw new ExternalEditorCallError(
      'failed',
      options.exactSkillResult
        ? 'The skill result exceeded its bounded MCP page. Retry load_skill with file, offset, and a smaller limit.'
        : 'The external result was too large and no recoverable artifact reference was available.',
    );
  }
  return JSON.parse(sanitized.body);
}

export function mcpToolError(error: unknown): {
  outcome: 'rejected' | 'cancelled' | 'stale' | 'failed';
  message: string;
} {
  const message = redactTextForAgentRuntime(
    error instanceof Error ? error.message : String(error),
  ).slice(0, 1_200) || 'External tool call failed.';
  return {
    outcome: error instanceof ExternalEditorCallError ? error.outcome : 'failed',
    message,
  };
}

export function toStructuredContent(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { result };
  const record = result as Record<string, unknown>;
  const images = embeddedImages(record);
  if (!images.length) return record;
  const { __images: _images, ...rest } = record;
  return {
    ...rest,
    images: images.map((image) => ({
      frame: image.frame,
      mimeType: image.mimeType ?? 'image/jpeg',
    })),
  };
}

export function toMcpContent(result: unknown): CallToolResult['content'] {
  const structured = toStructuredContent(result);
  return [
    { type: 'text', text: JSON.stringify(structured) },
    ...embeddedImages(result).map((image) => ({
      type: 'image' as const,
      data: image.base64,
      mimeType: image.mimeType ?? 'image/jpeg',
    })),
  ];
}
