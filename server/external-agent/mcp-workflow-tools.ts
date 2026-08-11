import { createReadStream } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { constants } from 'node:fs';
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ffprobeBin } from '../media-binaries.ts';
import { resolveOrHydrateUploadFile } from '../media-dir.ts';
import { ExternalEditorCallError, type EditorBinding } from './broker.ts';

type Args = Record<string, unknown>;
type InvokeEditor = (binding: EditorBinding, name: string, args: Args, timeoutMs?: number) => Promise<unknown>;

const SESSION_ID = {
  type: 'string',
  description: 'Session id returned by begin_edit_session.',
};

export const MCP_WORKFLOW_TOOLS: Tool[] = [
  {
    name: 'import_local_media',
    description: 'Import a local video, audio, image, GIF, or SVG file into the bound project in one MCP call. The server streams the file through OpenChatCut\'s verified upload handoff, probes media metadata, and finalizes the media-pool asset. Requires an open editor and an edit session created with approvalMode="auto".',
    inputSchema: {
      type: 'object',
      properties: {
        editSessionId: SESSION_ID,
        localPath: { type: 'string', description: 'Absolute path to a local media file on the OpenChatCut host.' },
        localPaths: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'string' }, description: 'Batch of absolute local media paths. Omit startFrame to append them on the selected/default tracks.' },
        assetId: { type: 'string', description: 'Optional existing asset id or unique prefix to replace.' },
        assetType: { type: 'string', enum: ['audio', 'gif', 'image', 'svg', 'video'], description: 'Optional override; normally inferred from the extension.' },
        contentType: { type: 'string', description: 'Optional MIME override; normally inferred from the extension.' },
        addToTimeline: { type: 'boolean', description: 'Place the imported asset on the active timeline. Defaults to true.' },
        trackId: { type: 'string', description: 'Optional target track, such as V1 or A1.' },
        startFrame: { type: 'integer', minimum: 0, description: 'Optional target start frame.' },
        ripple: { type: 'boolean', description: 'Push later clips on the target track when placing.' },
      },
      required: ['editSessionId'],
      anyOf: [{ required: ['localPath'] }, { required: ['localPaths'] }],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'export_timeline',
    description: 'Render the active timeline and optionally save the completed file to a local absolute path in one MCP call. Apply/review pending draft edits first, then use a fresh edit session created with approvalMode="auto". If the wait times out, use track_export with the returned renderId.',
    inputSchema: {
      type: 'object',
      properties: {
        editSessionId: SESSION_ID,
        format: { type: 'string', enum: ['video', 'audio'], description: 'Defaults to video.' },
        codec: { type: 'string', enum: ['h264', 'vp8', 'mp3', 'wav'] },
        resolution: { type: 'string', enum: ['480p', '720p', '1080p'] },
        fps: { type: 'integer', enum: [24, 25, 30, 50, 60] },
        videoBitrate: { type: 'integer', minimum: 1000000, maximum: 80000000 },
        name: { type: 'string', description: 'Export filename recorded by OpenChatCut.' },
        startFrame: { type: 'integer', minimum: 0 },
        endFrameExclusive: { type: 'integer', minimum: 1 },
        outputPath: { type: 'string', description: 'Optional absolute destination path on the OpenChatCut host. Existing files are not overwritten unless overwrite=true.' },
        overwrite: { type: 'boolean', description: 'Allow replacing outputPath when it already exists.' },
        timeoutSeconds: { type: 'number', minimum: 1, maximum: 540, description: 'How long to wait for rendering. Defaults to 540 seconds.' },
      },
      required: ['editSessionId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
];

export const MCP_WORKFLOW_TOOL_NAMES: Record<string, true> = Object.fromEntries(
  MCP_WORKFLOW_TOOLS.map((tool) => [tool.name, true]),
);

const MEDIA_TYPES: Record<string, { assetType: string; contentType: string }> = {
  '.mp4': { assetType: 'video', contentType: 'video/mp4' },
  '.mov': { assetType: 'video', contentType: 'video/quicktime' },
  '.m4v': { assetType: 'video', contentType: 'video/x-m4v' },
  '.webm': { assetType: 'video', contentType: 'video/webm' },
  '.mkv': { assetType: 'video', contentType: 'video/x-matroska' },
  '.mp3': { assetType: 'audio', contentType: 'audio/mpeg' },
  '.wav': { assetType: 'audio', contentType: 'audio/wav' },
  '.m4a': { assetType: 'audio', contentType: 'audio/mp4' },
  '.aac': { assetType: 'audio', contentType: 'audio/aac' },
  '.flac': { assetType: 'audio', contentType: 'audio/flac' },
  '.png': { assetType: 'image', contentType: 'image/png' },
  '.jpg': { assetType: 'image', contentType: 'image/jpeg' },
  '.jpeg': { assetType: 'image', contentType: 'image/jpeg' },
  '.webp': { assetType: 'image', contentType: 'image/webp' },
  '.gif': { assetType: 'gif', contentType: 'image/gif' },
  '.svg': { assetType: 'svg', contentType: 'image/svg+xml' },
};

interface ProbeMetadata {
  durationInSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudioTrack?: boolean;
}

function record(value: unknown, label: string): Args {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExternalEditorCallError('failed', `${label} returned an invalid result.`);
  }
  const result = value as Args;
  if (result.needs_confirmation === true) {
    throw new ExternalEditorCallError(
      'rejected',
      `${label} requested interactive confirmation. Composite MCP workflow tools require begin_edit_session with approvalMode="auto"; use the underlying low-level tools for manual confirmation.`,
    );
  }
  if (typeof result.error === 'string' && result.error) {
    throw new ExternalEditorCallError('failed', `${label}: ${result.error}`);
  }
  return result;
}

function positive(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function frameRate(value: unknown): number | undefined {
  if (typeof value !== 'string') return positive(value);
  const [numerator, denominator = '1'] = value.split('/');
  const top = Number(numerator);
  const bottom = Number(denominator);
  return Number.isFinite(top) && Number.isFinite(bottom) && bottom > 0 && top > 0
    ? top / bottom
    : undefined;
}

async function probeLocalMedia(path: string): Promise<ProbeMetadata> {
  return new Promise((resolveProbe, reject) => {
    const child = spawn(ffprobeBin(), [
      '-v', 'error', '-show_entries',
      'format=duration:stream=codec_type,width,height,avg_frame_rate',
      '-of', 'json', path,
    ], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed (${code}): ${stderr.slice(-400)}`));
        return;
      }
      try {
        const data = JSON.parse(stdout) as { format?: { duration?: unknown }; streams?: Array<Record<string, unknown>> };
        const streams = data.streams ?? [];
        const video = streams.find((stream) => stream.codec_type === 'video');
        resolveProbe({
          durationInSeconds: positive(data.format?.duration),
          width: positive(video?.width),
          height: positive(video?.height),
          fps: frameRate(video?.avg_frame_rate),
          hasAudioTrack: streams.some((stream) => stream.codec_type === 'audio'),
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function uploadFile(urlValue: string, path: string, headers: Record<string, string>): Promise<Args> {
  const url = new URL(urlValue);
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolveUpload, reject) => {
    const req = request(url, { method: 'POST', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: Args;
        try { body = text ? JSON.parse(text) as Args : {}; } catch { body = { error: text || 'invalid upload response' }; }
        if ((res.statusCode ?? 500) >= 400) {
          reject(new Error(typeof body.error === 'string' ? body.error : `upload failed (${res.statusCode})`));
        } else resolveUpload(body);
      });
    });
    req.once('error', reject);
    const stream = createReadStream(path);
    stream.once('error', reject);
    stream.pipe(req);
  });
}

function requireAbsolutePath(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || !isAbsolute(value.trim())) {
    throw new ExternalEditorCallError('rejected', `${field} must be an absolute local path.`);
  }
  return resolve(value.trim());
}

interface PreparedLocalImport {
  localPath: string;
  bytes: number;
  assetType: string;
  uploadedPath?: unknown;
  slotAssetId?: unknown;
  metadata: ProbeMetadata;
  finalizeArgs: Args;
}

async function prepareLocalImport(
  binding: EditorBinding,
  args: Args,
  localPathValue: unknown,
  invoke: InvokeEditor,
): Promise<PreparedLocalImport> {
  const localPath = requireAbsolutePath(localPathValue, 'localPath');
  const info = await stat(localPath).catch(() => null);
  if (!info?.isFile()) throw new ExternalEditorCallError('rejected', `Local media file not found: ${localPath}`);
  const inferred = MEDIA_TYPES[extname(localPath).toLowerCase()];
  const assetType = typeof args.assetType === 'string' ? args.assetType : inferred?.assetType;
  const contentType = typeof args.contentType === 'string' ? args.contentType : inferred?.contentType;
  if (!assetType || !contentType) {
    throw new ExternalEditorCallError('rejected', 'Unsupported extension; provide assetType and contentType explicitly.');
  }
  const editSessionId = String(args.editSessionId ?? '');
  const handoff = record(await invoke(binding, 'import_media', {
    editSessionId,
    action: 'create_session',
    assetType,
    contentType,
    filename: basename(localPath),
    size: info.size,
    ...(typeof args.assetId === 'string' ? { assetId: args.assetId } : {}),
  }), 'import_media');
  const slot = record(Array.isArray(handoff.slots) ? handoff.slots[0] : null, 'import_media slot');
  if (typeof slot.uploadUrl !== 'string') throw new ExternalEditorCallError('failed', 'import_media returned no upload URL.');
  const declaredHeaders = slot.headers && typeof slot.headers === 'object' && !Array.isArray(slot.headers)
    ? Object.fromEntries(Object.entries(slot.headers as Args).map(([key, value]) => [key, String(value)]))
    : { 'Content-Type': contentType, 'Content-Length': String(info.size) };
  const uploaded = record(await uploadFile(slot.uploadUrl, localPath, declaredHeaders), 'media upload');
  if (typeof uploaded.receipt !== 'string') throw new ExternalEditorCallError('failed', 'Media upload returned no receipt.');
  const metadata = await probeLocalMedia(localPath).catch(() => ({} as ProbeMetadata));
  if (['audio', 'video', 'gif'].includes(assetType) && !metadata.durationInSeconds) {
    throw new ExternalEditorCallError('failed', 'Could not determine media duration with ffprobe.');
  }
  const finalizeArgs = {
    editSessionId,
    receipt: uploaded.receipt,
    assetType,
    ...metadata,
    addToTimeline: args.addToTimeline !== false,
    ...(typeof args.trackId === 'string' ? { trackId: args.trackId } : {}),
    ...(typeof args.startFrame === 'number' ? { startFrame: args.startFrame } : {}),
    ...(args.ripple === true ? { ripple: true } : {}),
  };
  return {
    localPath,
    bytes: info.size,
    assetType,
    uploadedPath: uploaded.path,
    slotAssetId: slot.assetId,
    metadata,
    finalizeArgs,
  };
}

async function importLocalMedia(binding: EditorBinding, args: Args, invoke: InvokeEditor): Promise<unknown> {
  const values = Array.isArray(args.localPaths) ? args.localPaths : [args.localPath];
  if (!values.length || values.length > 32) {
    throw new ExternalEditorCallError('rejected', 'Provide 1 to 32 local media paths.');
  }
  if (values.length > 1 && typeof args.assetId === 'string') {
    throw new ExternalEditorCallError('rejected', 'assetId replacement is supported only for a single localPath.');
  }
  const prepared: PreparedLocalImport[] = [];
  for (const value of values) prepared.push(await prepareLocalImport(binding, args, value, invoke));
  const editSessionId = String(args.editSessionId ?? '');
  const batch = record(await invoke(binding, 'finalize_uploaded_assets', {
    editSessionId,
    items: prepared.map((item) => {
      const { editSessionId: _session, ...finalizeArgs } = item.finalizeArgs;
      return finalizeArgs;
    }),
  }), 'finalize_uploaded_assets');
  const results = Array.isArray(batch.results) ? batch.results : [];
  return {
    ok: batch.ok === true,
    count: prepared.length,
    failed: batch.failed ?? 0,
    assets: prepared.map((item, index) => {
      const finalized = results[index] && typeof results[index] === 'object' && !Array.isArray(results[index])
        ? results[index] as Args
        : {};
      return {
        localPath: item.localPath,
        bytes: item.bytes,
        assetId: finalized.assetId ?? item.slotAssetId,
        assetType: item.assetType,
        src: finalized.src ?? item.uploadedPath,
        metadata: item.metadata,
        addedToTimeline: finalized.addedToTimeline === true,
        timelineItemId: finalized.timelineItemId,
        finalized,
      };
    }),
  };
}

function completedExport(result: Args): Args | null {
  if (result.status === 'completed' || result.status === 'succeeded') return result;
  if (Array.isArray(result.jobs)) {
    const job = result.jobs.find((candidate) => candidate && typeof candidate === 'object') as Args | undefined;
    if (job && (job.status === 'completed' || job.status === 'succeeded')) return job;
  }
  return null;
}

async function saveExport(downloadUrl: string, outputPath: string, overwrite: boolean): Promise<number> {
  const url = new URL(downloadUrl, 'http://openchatcut.local');
  const match = /^\/media\/uploads\/([^/?#]+)$/.exec(url.pathname);
  if (!match) throw new ExternalEditorCallError('failed', 'Export returned an unsupported download URL.');
  const resolvedMedia = await resolveOrHydrateUploadFile(decodeURIComponent(match[1]!));
  if (!resolvedMedia) throw new ExternalEditorCallError('failed', 'Completed export file is unavailable.');
  await mkdir(dirname(outputPath), { recursive: true });
  await copyFile(resolvedMedia.file, outputPath, overwrite ? 0 : constants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'EEXIST') throw new ExternalEditorCallError('rejected', `Output already exists: ${outputPath}`);
    throw error;
  });
  return (await stat(outputPath)).size;
}

async function exportTimeline(binding: EditorBinding, args: Args, invoke: InvokeEditor): Promise<unknown> {
  const editSessionId = String(args.editSessionId ?? '');
  const submitArgs: Args = { editSessionId };
  for (const key of ['format', 'codec', 'resolution', 'fps', 'videoBitrate', 'name', 'startFrame', 'endFrameExclusive']) {
    if (args[key] !== undefined) submitArgs[key] = args[key];
  }
  const submitted = record(await invoke(binding, 'submit_render_job', submitArgs), 'submit_render_job');
  if (typeof submitted.renderId !== 'string') throw new ExternalEditorCallError('failed', 'submit_render_job returned no renderId.');
  const timeoutSeconds = Math.min(540, Math.max(1, Number(args.timeoutSeconds) || 540));
  const tracked = record(await invoke(binding, 'track_export', {
    editSessionId,
    action: 'wait',
    renderIds: submitted.renderId,
    timeoutSeconds,
  }, Math.min(600_000, (timeoutSeconds + 30) * 1000)), 'track_export');
  const completed = completedExport(tracked);
  if (!completed || typeof completed.downloadUrl !== 'string') {
    return { ok: true, renderId: submitted.renderId, completed: false, export: tracked };
  }
  const outputPath = args.outputPath === undefined ? undefined : requireAbsolutePath(args.outputPath, 'outputPath');
  const savedBytes = outputPath
    ? await saveExport(completed.downloadUrl, outputPath, args.overwrite === true)
    : undefined;
  return {
    ok: true,
    renderId: submitted.renderId,
    completed: true,
    downloadUrl: completed.downloadUrl,
    ...(outputPath ? { outputPath, savedBytes } : {}),
    export: completed,
  };
}

export async function executeMcpWorkflowTool(
  name: string,
  binding: EditorBinding,
  args: Args,
  invoke: InvokeEditor,
): Promise<unknown> {
  if (name === 'import_local_media') return importLocalMedia(binding, args, invoke);
  if (name === 'export_timeline') return exportTimeline(binding, args, invoke);
  throw new ExternalEditorCallError('rejected', `Unknown MCP workflow tool: ${name}`);
}
