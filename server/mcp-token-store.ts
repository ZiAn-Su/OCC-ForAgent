import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { atomicWriteFile } from './plugins/project-store-durable.ts';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * One MCP credential per local user installation. It deliberately lives
 * outside isolated development profiles so switching between source, test,
 * and packaged runtimes cannot silently change the effective token.
 */
export function globalMcpTokenPath(homeDir = homedir()): string {
  return join(homeDir, '.openchatcut', 'project-store-auth-v1', 'mcp-token-v1');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function validToken(raw: string): string | null {
  const token = raw.trim();
  return TOKEN_PATTERN.test(token) ? token : null;
}

export class McpTokenStore {
  private cached: string | null = null;
  private readonly path: string;
  private readonly environmentToken: () => string | undefined;

  constructor(
    path: string,
    environmentToken: () => string | undefined = () => process.env.OPENCHATCUT_MCP_TOKEN,
  ) {
    this.path = path;
    this.environmentToken = environmentToken;
  }

  isEnvironmentManaged(): boolean {
    return Boolean(this.environmentToken()?.trim());
  }

  current(): string {
    const configured = this.environmentToken()?.trim();
    if (configured) return configured;
    if (this.cached) return this.cached;

    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    try {
      const persisted = validToken(readFileSync(this.path, 'utf8'));
      if (persisted) {
        this.cached = persisted;
        return persisted;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const token = newToken();
    try {
      writeFileSync(this.path, `${token}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const winner = validToken(readFileSync(this.path, 'utf8'));
      if (!winner) throw new Error('the persisted MCP token is invalid');
      this.cached = winner;
      return winner;
    }
    chmodSync(this.path, 0o600);
    this.cached = token;
    return token;
  }

  async rotate(): Promise<string> {
    if (this.isEnvironmentManaged()) {
      throw new Error('OPENCHATCUT_MCP_TOKEN is managing the token; remove it before regenerating');
    }
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const token = newToken();
    await atomicWriteFile(this.path, `${token}\n`, { mode: 0o600 });
    await chmod(this.path, 0o600).catch(() => undefined);
    this.cached = token;
    return token;
  }
}
