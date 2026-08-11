# Edit an OpenChatCut project

## Start with current state

1. Call `openchatcut_status`.
2. Call `list_projects` when the project is not already identified.
3. Call `open_project` with the selected project ID for live editing, import,
   preview, render, or export. Use `bind_project_offline` only when the user
   explicitly requests offline data-only editing.
4. When specialized guidance applies, call `load_skill`; it requires no edit
   session or `editSessionId`.
5. Call `begin_edit_session` and keep the returned `editSessionId`.
6. Call `read_project` with that session ID before the first mutation.

Use `approvalMode: "manual"` by default. Use `"auto"` only when the user asks
for an unattended, atomic application.

## Load specialized guidance

Call `load_skill` after targeting the project and before specialized work. Common skill names include:

- `talking-head-guide`
- `transcription`
- `create-motion-graphics`
- `image-gen`
- `video-gen`
- `voice`
- `music`
- `shader-gen`
- `export`
- `verification`

Treat the live `load_skill` tool description as the current catalog. If a
loaded skill lists support files, request the relevant one with its `file`
argument.

## Apply edits

- Use IDs returned by `read_project`, discovery tools, or prior receipts.
- Keep every editor call in the same edit session.
- Re-read the project after a failed mutation or when the timeline may be
  stale.
- Use `view_timeline_frames`, `inspect_color`, or the verification skill after
  visual edits.
- Keep generation and other immediate side effects outside a proposal unless
  the exposed tool explicitly supports the draft session.

## Import local media

With the target project open and an `approvalMode: "auto"` edit session, prefer
`import_local_media` for files already on the OpenChatCut host. Pass an absolute `localPath`; media type and metadata are
normally inferred. It streams the bytes through the verified upload handoff,
finalizes the media-pool asset, and places it on the active timeline by default.
Use `addToTimeline: false` to keep it only in the pool, or pass `trackId`,
`startFrame`, and `ripple` for exact placement.
For a multi-source edit, pass up to 32 absolute paths in `localPaths`; their
receipts are finalized together so the project binding cannot go stale between
individual assets. Omit `startFrame` for a batch so normal track placement can
append each item.

The import is a live-project operation. If it advances the project revision,
refresh/retarget the MCP transport before starting the next draft rather than
reusing a stale binding.

## Review and finish

1. Call `review_edit_session` after all draft edits are ready.
2. For manual mode, tell the user the proposal is ready inside OpenChatCut.
3. Poll `get_edit_session` when the client needs the final state.
4. Report completion only when the status is `applied`.
5. If the status is `rejected` or `discarded`, report that exact result.

Applied operations form one atomic undo step.

## Export a deliverable

Apply the edit draft before rendering. Start a fresh bound session with
`approvalMode: "auto"`, then use
`export_timeline` to submit and wait for the active timeline export. Pass an
absolute `outputPath` to copy the completed render to a normal local file;
existing files are preserved unless `overwrite: true`. If the call returns
`completed: false`, continue with `track_export` and its `renderId`.
