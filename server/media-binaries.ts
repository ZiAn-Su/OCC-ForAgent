import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function optionalRequire<T>(id: string): T | undefined {
  try {
    return require(id) as T;
  } catch {
    return undefined;
  }
}

const ffmpegStatic = optionalRequire<string | null>('ffmpeg-static');
const ffprobeInstaller = optionalRequire<{ path?: string }>('@ffprobe-installer/ffprobe');

function remotionBinary(name: 'ffmpeg' | 'ffprobe'): string | undefined {
  try {
    const renderer = require('@remotion/renderer') as {
      RenderInternals?: {
        getExecutablePath?: (options: {
          type: 'ffmpeg' | 'ffprobe';
          indent: boolean;
          logLevel: 'error';
          binariesDirectory: null;
        }) => string;
      };
    };
    const executable = renderer.RenderInternals?.getExecutablePath?.({
      type: name,
      indent: false,
      logLevel: 'error',
      binariesDirectory: null,
    });
    return executable && existsSync(executable) ? executable : undefined;
  } catch {
    return undefined;
  }
}

export function selectMediaBinary(
  explicit: string | undefined,
  installed: string | null | undefined,
  remotion: string | undefined,
  command: 'ffmpeg' | 'ffprobe',
  fileExists: (path: string) => boolean = existsSync,
): string {
  if (explicit) return explicit;
  if (installed && fileExists(installed)) return installed;
  if (remotion && fileExists(remotion)) return remotion;
  return command;
}

/**
 * Prefer explicit overrides for developers who need a custom FFmpeg build.
 * Packaged desktop builds fall back to the platform binaries shipped through
 * production dependencies, so media import does not depend on the user's PATH.
 */
export function ffmpegBin(): string {
  return selectMediaBinary(
    process.env.OPENCHATCUT_FFMPEG ?? process.env.FFMPEG_PATH,
    ffmpegStatic,
    remotionBinary('ffmpeg'),
    'ffmpeg',
  );
}

export function ffprobeBin(): string {
  return selectMediaBinary(
    process.env.OPENCHATCUT_FFPROBE ?? process.env.FFPROBE_PATH,
    ffprobeInstaller?.path,
    remotionBinary('ffprobe'),
    'ffprobe',
  );
}
