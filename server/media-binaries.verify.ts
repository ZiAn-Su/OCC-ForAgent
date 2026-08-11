import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ffmpegBin, ffprobeBin, selectMediaBinary } from './media-binaries.ts';

const exists = (path: string): boolean => path === 'installed.exe' || path === 'remotion.exe';

assert.equal(selectMediaBinary('custom.exe', 'installed.exe', 'remotion.exe', 'ffmpeg', exists), 'custom.exe');
assert.equal(selectMediaBinary(undefined, 'installed.exe', 'remotion.exe', 'ffmpeg', exists), 'installed.exe');
assert.equal(selectMediaBinary(undefined, 'missing.exe', 'remotion.exe', 'ffmpeg', exists), 'remotion.exe');
assert.equal(selectMediaBinary(undefined, 'missing.exe', undefined, 'ffmpeg', exists), 'ffmpeg');

for (const [name, binary] of [['ffmpeg', ffmpegBin()], ['ffprobe', ffprobeBin()]] as const) {
  const result = spawnSync(binary, ['-version'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${name} is not executable: ${result.error?.message ?? result.stderr}`);
}

console.log('media binary verification passed');
