import assert from 'node:assert/strict';
import { MCP_WORKFLOW_TOOLS } from './mcp-workflow-tools.ts';
import { UPLOAD_TOOL_SCHEMAS } from '../../src/agent/tools/schemas/upload-tools.ts';

const byName = new Map(MCP_WORKFLOW_TOOLS.map((tool) => [tool.name, tool]));
assert.deepEqual([...byName.keys()].sort(), ['export_timeline', 'import_local_media']);

const importTool = byName.get('import_local_media');
assert(importTool?.inputSchema.required?.includes('editSessionId'));
assert('localPaths' in (importTool?.inputSchema.properties ?? {}));
assert('addToTimeline' in (importTool?.inputSchema.properties ?? {}));
assert('trackId' in (importTool?.inputSchema.properties ?? {}));

const exportTool = byName.get('export_timeline');
assert('outputPath' in (exportTool?.inputSchema.properties ?? {}));
assert('overwrite' in (exportTool?.inputSchema.properties ?? {}));

const finalize = UPLOAD_TOOL_SCHEMAS.find((tool) => tool.name === 'finalize_uploaded_asset');
assert('addToTimeline' in (finalize?.input_schema.properties ?? {}));
assert('startFrame' in (finalize?.input_schema.properties ?? {}));
assert(UPLOAD_TOOL_SCHEMAS.some((tool) => tool.name === 'finalize_uploaded_assets'));

console.log('mcp-workflow-tools.verify: ok');
