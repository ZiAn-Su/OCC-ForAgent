import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { globalMcpTokenPath, McpTokenStore } from './mcp-token-store.ts';

const fixture = await mkdtemp(join(tmpdir(), 'openchatcut-mcp-token-'));
try {
  assert.equal(
    globalMcpTokenPath(fixture),
    join(fixture, '.openchatcut', 'project-store-auth-v1', 'mcp-token-v1'),
    'the MCP token path must be user-global and independent of runtime profiles',
  );
  const path = join(fixture, 'private', 'mcp-token-v1');
  const firstStore = new McpTokenStore(path, () => undefined);
  const first = firstStore.current();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await readFile(path, 'utf8')).trim(), first);

  const restartedStore = new McpTokenStore(path, () => undefined);
  assert.equal(restartedStore.current(), first, 'the token must survive a server restart');

  const rotated = await restartedStore.rotate();
  assert.notEqual(rotated, first, 'rotation must invalidate the previous token');
  assert.equal(new McpTokenStore(path, () => undefined).current(), rotated);

  const environmentStore = new McpTokenStore(path, () => 'environment-token');
  assert.equal(environmentStore.current(), 'environment-token');
  assert.equal(environmentStore.isEnvironmentManaged(), true);
  await assert.rejects(() => environmentStore.rotate(), /OPENCHATCUT_MCP_TOKEN/);
} finally {
  await rm(fixture, { recursive: true, force: true });
}

console.log('MCP token persistence verification passed');
