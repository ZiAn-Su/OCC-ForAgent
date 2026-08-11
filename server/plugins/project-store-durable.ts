import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

interface DurableHandle {
  writeFile?: (data: string | Uint8Array) => Promise<void>;
  sync: () => Promise<void>;
  close: () => Promise<void>;
}

export interface AtomicWriteOperations {
  open: (path: string, flags: string, mode?: number) => Promise<DurableHandle>;
  rename: (source: string, target: string) => Promise<void>;
  rm: (path: string, options: { force: boolean }) => Promise<void>;
}

const DEFAULT_ATOMIC_OPERATIONS: AtomicWriteOperations = {
  open: async (path, flags, mode) => {
    const handle = await open(path, flags, mode);
    return {
      writeFile: async (data) => handle.writeFile(data),
      sync: async () => handle.sync(),
      close: async () => handle.close(),
    };
  },
  rename,
  rm,
};

function unsupportedDirectorySync(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return process.platform === 'win32' && ['EACCES', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(code ?? '');
}

export async function syncDirectory(
  directory: string,
  operations: AtomicWriteOperations = DEFAULT_ATOMIC_OPERATIONS,
): Promise<void> {
  let handle: DurableHandle | undefined;
  try {
    handle = await operations.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (!unsupportedDirectorySync(error)) throw error;
  } finally {
    await handle?.close();
  }
}

async function cleanupTemp(
  temp: string,
  directory: string,
  operations: AtomicWriteOperations,
): Promise<void> {
  try {
    await operations.rm(temp, { force: true });
    await syncDirectory(directory, operations);
  } catch {
    // Preserve the original write failure. A random temp can never replace another writer's file.
  }
}

export async function atomicWriteFile(
  target: string,
  data: string | Uint8Array,
  options: { mode?: number; operations?: AtomicWriteOperations } = {},
): Promise<void> {
  const operations = options.operations ?? DEFAULT_ATOMIC_OPERATIONS;
  const directory = dirname(target);
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  let handle: DurableHandle | undefined;
  let renamed = false;
  try {
    handle = await operations.open(temp, 'wx', options.mode ?? 0o600);
    if (!handle.writeFile) throw new Error('atomic write handle is not writable');
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await operations.rename(temp, target);
    renamed = true;
    await syncDirectory(directory, operations);
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      // Preserve the original write failure.
    }
    if (!renamed) await cleanupTemp(temp, directory, operations);
    throw error;
  }
}

export async function atomicWriteJson(target: string, value: unknown): Promise<void> {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('project store value is not JSON serializable');
  await atomicWriteFile(target, encoded);
}

export async function durableMkdir(path: string, recursive = false): Promise<void> {
  await mkdir(path, { recursive, mode: 0o700 });
  await syncDirectory(dirname(path));
}

export async function durableRemove(path: string, recursive = false): Promise<void> {
  await rm(path, { force: true, recursive });
  await syncDirectory(dirname(path));
}

function transientWindowsDirectoryError(error: unknown): boolean {
  if (process.platform !== 'win32') return false;
  return ['EACCES', 'EBUSY', 'ENOTEMPTY', 'EPERM'].includes(
    (error as NodeJS.ErrnoException).code ?? '',
  );
}

export async function durableRename(source: string, target: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rename(source, target);
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      if (!transientWindowsDirectoryError(error) || attempt === 7) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
  if (lastError) throw lastError;
  const sourceDirectory = dirname(source);
  const targetDirectory = dirname(target);
  await syncDirectory(sourceDirectory);
  if (targetDirectory !== sourceDirectory) await syncDirectory(targetDirectory);
}

interface LeaseOwner {
  token: string;
  pid: number;
  expiresAt: number;
}

export interface OwnerSafeLease {
  token: string;
  release: () => Promise<void>;
}

export interface OwnerSafeLeaseOptions {
  path: string;
  leaseMs?: number;
  heartbeatMs?: number;
  retries?: number;
  retryMs?: number;
  pid?: number;
  now?: () => number;
  isPidAlive?: (pid: number) => boolean;
}

interface LeaseConfig {
  path: string;
  guardPath: string;
  leaseMs: number;
  heartbeatMs: number;
  retries: number;
  retryMs: number;
  pid: number;
  now: () => number;
  isPidAlive: (pid: number) => boolean;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function validOwner(value: unknown): value is LeaseOwner {
  if (!value || typeof value !== 'object') return false;
  const owner = value as Partial<LeaseOwner>;
  return typeof owner.token === 'string'
    && typeof owner.pid === 'number'
    && Number.isInteger(owner.pid)
    && owner.pid > 0
    && typeof owner.expiresAt === 'number'
    && Number.isFinite(owner.expiresAt);
}

async function readOwner(path: string): Promise<LeaseOwner | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'));
    return validOwner(parsed) ? parsed : undefined;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function expiredWithoutOwner(path: string, config: LeaseConfig): Promise<boolean> {
  try {
    return (await stat(path)).mtimeMs + config.leaseMs <= config.now();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
async function canReap(path: string, config: LeaseConfig): Promise<boolean> {
  const owner = await readOwner(path);
  if (!owner) return expiredWithoutOwner(path, config);
  return owner.expiresAt <= config.now() && !config.isPidAlive(owner.pid);
}

/** The guard protects only the short filesystem mutation that creates, renews,
 * or releases the real lease. Unlike the lease itself it has no heartbeat. If
 * that mutation throws after creating the guard, the owning process may stay
 * alive indefinitely; expiry must therefore be sufficient to recover it. */
async function canReapGuard(path: string, config: LeaseConfig): Promise<boolean> {
  const owner = await readOwner(path);
  if (!owner) return expiredWithoutOwner(path, config);
  return owner.expiresAt <= config.now();
}

async function moveAside(path: string, reason: string): Promise<string | undefined> {
  const moved = `${path}.${reason}.${process.pid}.${randomUUID()}`;
  try {
    await durableRename(path, moved);
    return moved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function createOwnedDirectory(path: string, owner: LeaseOwner): Promise<boolean> {
  try {
    await durableMkdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  try {
    await atomicWriteJson(join(path, 'owner.json'), owner);
    return true;
  } catch (error) {
    await durableRemove(path, true);
    throw error;
  }
}

async function releaseOwnedDirectory(path: string, token: string): Promise<void> {
  if ((await readOwner(path))?.token !== token) return;
  const moved = await moveAside(path, `released-${token}`);
  if (moved) await durableRemove(moved, true);
}

async function acquireGuard(config: LeaseConfig): Promise<() => Promise<void>> {
  // A guard covers one local metadata mutation only. Keep its stale timeout
  // comfortably inside the caller's retry window instead of inheriting the
  // long-lived lease timeout. This is especially important on Windows, where
  // a directory rename/remove can fail transiently after the owner file was
  // closed and otherwise strand every request for the full lease duration.
  const guardLeaseMs = Math.min(
    config.leaseMs,
    Math.max(100, Math.floor(config.retries * config.retryMs / 4)),
  );
  for (let attempt = 0; attempt < config.retries; attempt += 1) {
    const owner = { token: randomUUID(), pid: config.pid, expiresAt: config.now() + guardLeaseMs };
    if (await createOwnedDirectory(config.guardPath, owner)) {
      return async () => {
        try {
          await releaseOwnedDirectory(config.guardPath, owner.token);
        } catch (error) {
          // The guard has no heartbeat and is intentionally short-lived, so a
          // transient Windows directory handle cannot invalidate completed
          // project-store work. The next contender will reap it after expiry.
          if (!transientWindowsDirectoryError(error)) throw error;
        }
      };
    }
    if (await canReapGuard(config.guardPath, config)) {
      const moved = await moveAside(config.guardPath, 'stale');
      if (moved) await durableRemove(moved, true);
      continue;
    }
    await delay(config.retryMs);
  }
  throw new Error('project store lock guard is busy');
}

async function tryClaim(owner: LeaseOwner, config: LeaseConfig): Promise<boolean> {
  if (await createOwnedDirectory(config.path, owner)) return true;
  if (!(await canReap(config.path, config))) return false;
  const moved = await moveAside(config.path, 'stale');
  if (moved) await durableRemove(moved, true);
  return createOwnedDirectory(config.path, owner);
}

async function mutateWithGuard<T>(config: LeaseConfig, work: () => Promise<T>): Promise<T> {
  const releaseGuard = await acquireGuard(config);
  try {
    return await work();
  } finally {
    await releaseGuard();
  }
}

async function renewOwner(owner: LeaseOwner, config: LeaseConfig): Promise<boolean> {
  return mutateWithGuard(config, async () => {
    if ((await readOwner(config.path))?.token !== owner.token) return false;
    owner.expiresAt = config.now() + config.leaseMs;
    await atomicWriteJson(join(config.path, 'owner.json'), owner);
    return true;
  });
}

async function releaseOwner(owner: LeaseOwner, config: LeaseConfig): Promise<void> {
  await mutateWithGuard(config, () => releaseOwnedDirectory(config.path, owner.token));
}

function startHeartbeat(owner: LeaseOwner, config: LeaseConfig): OwnerSafeLease {
  let released = false;
  let pending = Promise.resolve();
  const timer = setInterval(() => {
    pending = pending.then(async () => {
      if (!(await renewOwner(owner, config))) clearInterval(timer);
    }).catch(() => undefined);
  }, config.heartbeatMs);
  timer.unref();
  return {
    token: owner.token,
    release: async () => {
      if (released) return;
      released = true;
      clearInterval(timer);
      await pending;
      await releaseOwner(owner, config);
    },
  };
}

function normalizeOptions(options: OwnerSafeLeaseOptions): LeaseConfig {
  const leaseMs = options.leaseMs ?? 10_000;
  return {
    path: options.path,
    guardPath: `${options.path}.guard`,
    leaseMs,
    heartbeatMs: options.heartbeatMs ?? Math.max(10, Math.floor(leaseMs / 3)),
    retries: options.retries ?? 200,
    retryMs: options.retryMs ?? 10,
    pid: options.pid ?? process.pid,
    now: options.now ?? Date.now,
    isPidAlive: options.isPidAlive ?? pidIsAlive,
  };
}

export function createOwnerSafeLeaseLock(options: OwnerSafeLeaseOptions): {
  acquire: () => Promise<OwnerSafeLease>;
} {
  const config = normalizeOptions(options);
  return {
    acquire: async () => {
      await durableMkdir(dirname(config.path), true);
      for (let attempt = 0; attempt < config.retries; attempt += 1) {
        const owner = { token: randomUUID(), pid: config.pid, expiresAt: config.now() + config.leaseMs };
        const acquired = await mutateWithGuard(config, () => tryClaim(owner, config));
        if (acquired) return startHeartbeat(owner, config);
        await delay(config.retryMs);
      }
      throw new Error('project store is busy');
    },
  };
}
