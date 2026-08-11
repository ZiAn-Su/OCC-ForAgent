import { spawn } from 'node:child_process';

export type ProjectEditorOpenSurface = 'desktop' | 'browser';
export type ProjectEditorOpener = (url: string) => Promise<ProjectEditorOpenSurface>;

let registeredOpener: ProjectEditorOpener | null = null;

function validatedEditorUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Editor URL is invalid.');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new Error('Editor URL must be an HTTP(S) URL without embedded credentials.');
  }
  return url.href;
}

function browserCommand(url: string): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  }
  if (process.platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

async function openSystemBrowser(url: string): Promise<ProjectEditorOpenSurface> {
  const launch = browserCommand(url);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
  return 'browser';
}

export function registerProjectEditorOpener(opener: ProjectEditorOpener): () => void {
  registeredOpener = opener;
  return () => {
    if (registeredOpener === opener) registeredOpener = null;
  };
}

export async function openProjectEditor(url: string): Promise<ProjectEditorOpenSurface> {
  const safeUrl = validatedEditorUrl(url);
  return registeredOpener ? registeredOpener(safeUrl) : openSystemBrowser(safeUrl);
}

export function setProjectEditorOpenerForTest(opener: ProjectEditorOpener | null): void {
  registeredOpener = opener;
}
