import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const MCP_CONTROL_TOOLS: Tool[] = [
  {
    name: 'openchatcut_status',
    description: 'Show connected OpenChatCut editors, this transport session binding, and capability status.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'list_projects',
    description: 'List OpenChatCut projects, newest first.',
    inputSchema: {
      type: 'object',
      properties: {
        includeDeleted: { type: 'boolean' },
        editorBaseUrl: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'create_project',
    description: 'Create an empty OpenChatCut project with one active timeline and one video track.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        compositionWidth: { type: 'number' },
        compositionHeight: { type: 'number' },
        fps: { type: 'number' },
        editorBaseUrl: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'get_project',
    description: 'Get one project metadata and timeline summary. Optionally include the complete stored project document.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Full project id from list_projects.' },
        includeDeleted: { type: 'boolean', description: 'Allow inspecting a soft-deleted project.' },
        includeDocument: { type: 'boolean', description: 'Include the complete project document; default false.' },
        editorBaseUrl: { type: 'string' },
      },
      required: ['projectId'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_project_agent_state',
    description: 'Read the project-level durable Agent state, including an active edit session that can be resumed after an MCP client restart.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Full project id. Defaults to this MCP session binding when present.' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'update_project',
    description: 'Update an active project name and/or description without opening the editor.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Full project id from list_projects.' },
        name: { type: 'string' },
        description: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description: 'New description. Pass null or an empty string to clear it.',
        },
        editorBaseUrl: { type: 'string' },
      },
      required: ['projectId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'delete_project',
    description: 'Soft-delete a project. The document is retained and can be recovered with restore_project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Full project id; never defaults to the bound project.' },
      },
      required: ['projectId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'restore_project',
    description: 'Restore a project previously soft-deleted with delete_project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Full project id.' },
        editorBaseUrl: { type: 'string' },
      },
      required: ['projectId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'bind_project_offline',
    description: 'Advanced: bind this MCP session to stored project data without opening an editor. Import, preview, render, and export will be unavailable.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, editorBaseUrl: { type: 'string' } },
      required: ['projectId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'open_project',
    description: 'Open a project in the OpenChatCut editor, wait for its live editor bridge, and bind this MCP session to it.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Full project id from list_projects.' },
        waitSeconds: {
          type: 'number',
          description: 'How long to wait for the editor bridge, from 0 to 45 seconds; default 20.',
        },
      },
      required: ['projectId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_editor_url',
    description: 'Return the OpenChatCut editor URL for this session project or an explicitly named project.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, editorBaseUrl: { type: 'string' } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'recover_edit_session',
    description: 'Discard an edit session left behind by a disconnected MCP transport in this already-open project. Normal use clears an orphan; force:true is required to take over a still-recorded transport after it has failed.',
    inputSchema: {
      type: 'object',
      properties: {
        editSessionId: { type: 'string', description: 'The orphaned editSessionId reported by the failed workflow.' },
        force: { type: 'boolean', description: 'Required only when the old MCP transport did not close cleanly. This discards its active draft.' },
      },
      required: ['editSessionId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'resume_edit_session',
    description: 'Reconnect this MCP transport to an existing durable edit draft in the already-open project. This keeps its staged work. force:true is required only when a failed transport is still recorded as owner.',
    inputSchema: {
      type: 'object',
      properties: {
        editSessionId: { type: 'string', description: 'The active editSessionId to resume.' },
        force: { type: 'boolean', description: 'Explicitly take over a session whose former MCP transport failed without closing.' },
      },
      required: ['editSessionId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

export const MCP_CONTROL_TOOL_NAMES: Record<string, true> = Object.fromEntries(
  MCP_CONTROL_TOOLS.map((tool) => [tool.name, true]),
);

// The editor's internal agent still owns a legacy target_project tool. Keep it
// filtered out of the external MCP catalog so agents cannot enter offline mode
// through the old ambiguous name.
MCP_CONTROL_TOOL_NAMES.target_project = true;
