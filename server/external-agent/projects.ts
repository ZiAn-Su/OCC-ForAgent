import { randomUUID } from 'node:crypto';
import { CURRENT_PROJECT_VERSION } from '../../shared/project-version.ts';
import { runProjectMigrations } from '../../src/persist/migrations/index.ts';
import type { ProjectDoc } from '../../src/editor/types.ts';
import { withProjectStoreLock, type LockedProjectStore } from '../plugins/project-store.ts';
import { ExternalEditorCallError } from './broker.ts';

const VALID_PROJECT_ID = /^[a-zA-Z0-9_-]{1,160}$/;
const MAX_PROJECT_NAME_LENGTH = 200;
const MAX_PROJECT_DESCRIPTION_LENGTH = 4_000;

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  deletedAt?: number;
  description?: string;
}

function rejected(message: string): never {
  throw new ExternalEditorCallError('rejected', message);
}

function projectMetas(value: unknown): ProjectMeta[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ProjectMeta => (
    !!entry
    && typeof entry === 'object'
    && typeof (entry as ProjectMeta).id === 'string'
    && typeof (entry as ProjectMeta).name === 'string'
    && typeof (entry as ProjectMeta).updatedAt === 'number'
  ));
}

function projectId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!VALID_PROJECT_ID.test(id)) rejected('A valid full projectId is required.');
  return id;
}

function projectName(value: unknown, fallback?: string): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name && fallback !== undefined) return fallback;
  if (!name) rejected('Project name cannot be empty.');
  if (name.length > MAX_PROJECT_NAME_LENGTH) {
    rejected(`Project name cannot exceed ${MAX_PROJECT_NAME_LENGTH} characters.`);
  }
  return name;
}

function projectDescription(value: unknown): string {
  if (typeof value !== 'string') rejected('Project description must be a string or null.');
  const description = value.trim();
  if (description.length > MAX_PROJECT_DESCRIPTION_LENGTH) {
    rejected(`Project description cannot exceed ${MAX_PROJECT_DESCRIPTION_LENGTH} characters.`);
  }
  return description;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function emptyProject(args: Record<string, unknown>): ProjectDoc {
  const timelineId = `tl_${randomUUID()}`;
  const timeline = {
    id: timelineId,
    name: '序列 1',
    order: 0,
    fps: positiveNumber(args.fps, 30),
    width: positiveNumber(args.compositionWidth, 1920),
    height: positiveNumber(args.compositionHeight, 1080),
    items: [],
    selectedId: null,
    trackOrder: ['track_v1'],
    tracks: { track_v1: { kind: 'video' as const } },
  };
  return {
    version: CURRENT_PROJECT_VERSION,
    assets: [],
    mediaFolders: [],
    timelines: [timeline],
    activeTimelineId: timelineId,
  };
}

async function indexFrom(store: LockedProjectStore): Promise<ProjectMeta[]> {
  const entry = await store.readEntry('projects');
  return projectMetas(entry.value);
}

function findProject(projects: ProjectMeta[], id: string): ProjectMeta {
  const project = projects.find((entry) => entry.id === id);
  if (!project) rejected(`Project not found: ${id}`);
  return project;
}

function projectSummary(doc: ProjectDoc): Record<string, unknown> {
  return {
    version: doc.version,
    assetCount: doc.assets.length,
    timelineCount: doc.timelines.length,
    activeTimelineId: doc.activeTimelineId,
    timelines: doc.timelines.map((timeline) => ({
      id: timeline.id,
      name: timeline.name,
      width: timeline.width,
      height: timeline.height,
      fps: timeline.fps,
      itemCount: timeline.items.length,
    })),
  };
}

export async function listExternalProjects(includeDeleted = false): Promise<ProjectMeta[]> {
  return withProjectStoreLock(async (store) => (await indexFrom(store))
    .filter((project) => includeDeleted || !project.deletedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt));
}

export async function getExternalProject(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = projectId(args.projectId);
  return withProjectStoreLock(async (store) => {
    const meta = findProject(await indexFrom(store), id);
    if (meta.deletedAt && args.includeDeleted !== true) {
      rejected(`Project is deleted: ${id}. Pass includeDeleted=true to inspect it.`);
    }
    const stored = await store.readEntry(`project:${id}`);
    const doc = stored.found ? runProjectMigrations(stored.value)?.doc ?? null : null;
    if (!doc) throw new ExternalEditorCallError('failed', `Project document is missing or invalid: ${id}`);
    return {
      ...meta,
      deletionState: meta.deletedAt ? 'deleted' : 'active',
      summary: projectSummary(doc),
      ...(args.includeDocument === true ? { document: doc } : {}),
    };
  });
}

export async function createExternalProject(
  args: Record<string, unknown>,
): Promise<ProjectMeta & { timelineId: string }> {
  const name = projectName(args.name, 'External MCP Project');
  const description = args.description === undefined ? '' : projectDescription(args.description);
  const doc = emptyProject(args);
  const meta: ProjectMeta = {
    id: randomUUID(),
    name,
    updatedAt: Date.now(),
    ...(description ? { description } : {}),
  };
  return withProjectStoreLock(async (store) => {
    const projects = await indexFrom(store);
    const documentKey = `project:${meta.id}`;
    await store.writeEntry(documentKey, doc);
    try {
      await store.writeEntry('projects', [meta, ...projects]);
    } catch (error) {
      await store.removeEntry(documentKey).catch(() => undefined);
      throw error;
    }
    return { ...meta, timelineId: doc.activeTimelineId };
  });
}

export async function updateExternalProject(
  args: Record<string, unknown>,
): Promise<ProjectMeta> {
  const id = projectId(args.projectId);
  const hasName = args.name !== undefined;
  const hasDescription = args.description !== undefined;
  if (!hasName && !hasDescription) rejected('Provide name and/or description to update.');
  const name = hasName ? projectName(args.name) : undefined;
  const description = hasDescription && args.description !== null
    ? projectDescription(args.description)
    : undefined;
  return withProjectStoreLock(async (store) => {
    const projects = await indexFrom(store);
    const current = findProject(projects, id);
    if (current.deletedAt) rejected(`Project is deleted: ${id}. Restore it before updating.`);
    const updated: ProjectMeta = { ...current, updatedAt: Date.now() };
    if (name !== undefined) updated.name = name;
    if (args.description === null || description === '') delete updated.description;
    else if (description !== undefined) updated.description = description;
    await store.writeEntry('projects', projects.map((entry) => entry.id === id ? updated : entry));
    return updated;
  });
}

export async function deleteExternalProject(projectIdValue: unknown): Promise<ProjectMeta> {
  const id = projectId(projectIdValue);
  return withProjectStoreLock(async (store) => {
    const projects = await indexFrom(store);
    const current = findProject(projects, id);
    if (current.deletedAt) return current;
    const deletedAt = Date.now();
    const deleted = { ...current, updatedAt: deletedAt, deletedAt };
    await store.writeEntry('projects', projects.map((entry) => entry.id === id ? deleted : entry));
    return deleted;
  });
}

export async function restoreExternalProject(projectIdValue: unknown): Promise<ProjectMeta> {
  const id = projectId(projectIdValue);
  return withProjectStoreLock(async (store) => {
    const projects = await indexFrom(store);
    const current = findProject(projects, id);
    if (!current.deletedAt) return current;
    const restored: ProjectMeta = { ...current, updatedAt: Date.now() };
    delete restored.deletedAt;
    await store.writeEntry('projects', projects.map((entry) => entry.id === id ? restored : entry));
    return restored;
  });
}
