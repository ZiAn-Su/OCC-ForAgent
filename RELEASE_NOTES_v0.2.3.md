# OCC-ForAgent v0.2.3

OCC-ForAgent v0.2.3 is a reliability release for uninterrupted MCP video-editing workflows. It is based on OpenChatCut v0.2.0 and remains licensed under AGPL-3.0-or-later with upstream attribution preserved.

## Highlights

- Added `recover_edit_session` for an edit draft stranded after an MCP client or Agent process is interrupted.
- A new authenticated MCP transport can reopen the same project, discard the orphaned draft, and start a replacement editing session without creating a new project.
- The normal recovery path only accepts a disconnected owner. `force: true` is an explicit, destructive takeover for a client that failed without sending its close frame.
- Preserves a trusted `localhost` editor origin when MCP opens the editor, avoiding false disconnected-editor results caused by an IPv6 loopback URL.
- Accepts bounded skill playbooks such as `create-motion-graphics` without rejecting their valid, paged MCP result.
- Hardens short-lived Agent-run ownership contention so external workflows retry and recover instead of failing on transient leases.

## Upgrade note

No Token rotation or reinstall is required for the source service. Restart OpenChatCut after upgrading, then reconnect the MCP client. When a prior workflow reports an active `editSessionId` owned by another transport:

1. Call `open_project` for the existing project in a fresh MCP connection.
2. Call `recover_edit_session` with the reported `editSessionId`.
3. If the result says another transport is still recorded but that client is known to have failed, retry with `force: true`.
4. Start a new `begin_edit_session` and continue the existing project.
