import type { IncomingMessage, ServerResponse } from 'node:http';
import { TLSSocket } from 'node:tls';
import type { Plugin } from 'vite';
import {
  editorRegistrationMatches,
  nextEditorCall,
  nextEditorCancellation,
  registerEditor,
  settleEditorCall,
  unregisterEditor,
} from '../external-agent/broker.ts';
import { handleMcpRequest, mcpTools } from '../external-agent/mcp.ts';
import { claimBrowserProjectOwnership } from '../external-agent/project-edit-ownership.ts';
import {
  EDITOR_BOOTSTRAP_HEADER,
  configuredEditorOrigin,
  editorBootstrapPayload,
  editorCredentialAuthorized,
  externalMcpAuthorized,
  headerValue,
  rotateExternalMcpToken,
  trustedEditorRequest,
} from '../editor-auth.ts';
import {
  readBridgeJson,
  routeExternalAgentBridge,
  sendBridgeJson,
  type BridgeOperations,
} from './external-agent-bridge-routes.ts';
import { isLoopbackAddress } from '../loopback-address.ts';

export type { BridgeOperations } from './external-agent-bridge-routes.ts';


const bridgeOperations: BridgeOperations = {
  claimBrowserOwnership: claimBrowserProjectOwnership,
  editorRegistrationMatches,
  registerEditor,
  unregisterEditor,
  nextEditorCall,
  nextEditorCancellation,
  settleEditorCall,
  mcpTools,
};







const LOCAL_EDITOR_HOSTS: Readonly<Record<string, true>> = {
  localhost: true,
  '127.0.0.1': true,
  '[::1]': true,
};

/**
 * Use the MCP caller's loopback Host first. On Windows a Vite listener often
 * accepts localhost through ::1; opening that raw socket address in the system
 * browser is less reliable than reopening the caller's localhost origin.
 */
export function mcpRequestBaseUrl(req: IncomingMessage): string {
  const configured = configuredEditorOrigin();
  if (configured) return configured;
  const protocol = req.socket instanceof TLSSocket ? 'https:' : 'http:';
  const requestedHost = headerValue(req, 'host');
  if (requestedHost && !/[/\\@?#,\s]/.test(requestedHost)) {
    try {
      const requested = new URL(`${protocol}//${requestedHost}`);
      if (LOCAL_EDITOR_HOSTS[requested.hostname.toLowerCase()] === true) return requested.origin;
    } catch {
      // Fall back to the socket address below.
    }
  }
  const address = req.socket.localAddress;
  const port = req.socket.localPort;
  if (address && port && isLoopbackAddress(address)) {
    const normalized = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
    const host = normalized.includes(':') ? `[${normalized}]` : normalized;
    return `${protocol}//${host}:${port}`;
  }
  return `${protocol}//${headerValue(req, 'host') ?? '127.0.0.1:5199'}`;
}

function isJsonRequest(req: IncomingMessage): boolean {
  const contentType = headerValue(req, 'content-type');
  return contentType?.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

async function handleEditorBootstrap(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!trustedEditorRequest(req, true)) {
    sendBridgeJson(res, 403, { error: 'untrusted editor origin' });
    return;
  }
  if (!isJsonRequest(req) || headerValue(req, EDITOR_BOOTSTRAP_HEADER) !== '1') {
    sendBridgeJson(res, 415, { error: 'editor bootstrap requires JSON and bootstrap header' });
    return;
  }
  if (!editorCredentialAuthorized(req, true)) {
    sendBridgeJson(res, 401, { error: 'invalid editor launch credential' });
    return;
  }
  await readBridgeJson(req);
  sendBridgeJson(res, 200, editorBootstrapPayload());
}

export async function handleExternalAgentBridge(
  req: IncomingMessage,
  res: ServerResponse,
  operations: BridgeOperations = bridgeOperations,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/bootstrap') {
    await handleEditorBootstrap(req, res);
    return;
  }
  const write = req.method === 'POST';
  if (!trustedEditorRequest(req, write)) {
    sendBridgeJson(res, 403, { error: 'untrusted editor origin' });
    return;
  }
  if (!editorCredentialAuthorized(req, write)) {
    sendBridgeJson(res, 401, { error: 'invalid editor bridge credential' });
    return;
  }
  if (write && !isJsonRequest(req)) {
    sendBridgeJson(res, 415, { error: 'editor bridge writes require JSON' });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/mcp-token/rotate') {
    await readBridgeJson(req);
    sendBridgeJson(res, 200, await rotateExternalMcpToken());
    return;
  }
  await routeExternalAgentBridge(req, res, url, operations);
}

export function externalAgentPlugin(): Plugin {
  return {
    name: 'openchatcut-external-agent',
    configureServer(server) {
      server.middlewares.use('/api/external-agent', (req, res) => {
        void handleExternalAgentBridge(req, res).catch((error) => {
          if (!res.headersSent) sendBridgeJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
        });
      });
      server.middlewares.use('/api/external-mcp/mcp', (req, res) => {
        if (!externalMcpAuthorized(req)) {
          sendBridgeJson(res, 401, { error: 'invalid OpenChatCut MCP token' });
          return;
        }
        void handleMcpRequest(req, res, mcpRequestBaseUrl(req)).catch((error) => {
          server.config.logger.error(`[external-mcp] ${error instanceof Error ? error.message : String(error)}`);
          if (!res.headersSent) sendBridgeJson(res, 500, { error: 'MCP request failed' });
        });
      });
    },
  };
}
