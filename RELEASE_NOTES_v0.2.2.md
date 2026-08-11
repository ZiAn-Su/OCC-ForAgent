# OCC-ForAgent v0.2.2

OCC-ForAgent v0.2.2 is an agent-workflow reliability release based on OpenChatCut v0.2.0. It remains licensed under AGPL-3.0-or-later and preserves upstream attribution.

OCC-ForAgent v0.2.2 是基于 OpenChatCut v0.2.0 的 Agent 工作流可靠性更新，继续采用 AGPL-3.0-or-later，并保留上游署名。

## Highlights / 主要更新

- MCP agents can create, list, inspect, rename, open, and delete projects, then bind a project for server-direct editing without keeping an editor window open.
- MCP 智能体可创建、列出、查看、重命名、打开和删除工程，并可在不保持编辑器窗口打开的情况下绑定工程进行服务端直接剪辑。
- Local-media import, timeline editing, rendering, waiting, and export remain available as one MCP-only workflow.
- 本地素材导入、时间线剪辑、渲染、等待和导出继续支持纯 MCP 全流程执行。
- FFmpeg discovery now validates installed binaries and falls back to the Remotion-bundled tools when `ffmpeg-static` is incomplete.
- FFmpeg 发现逻辑会验证文件是否存在，并在 `ffmpeg-static` 不完整时自动使用 Remotion 随包工具。
- The MCP token is generated once per local runtime profile, stored outside the repository, reused across restarts, and rotatable from the trusted MCP settings dialog.
- MCP Token 按本机运行配置首次生成并保存在仓库外，重启后保持不变，也可从受信任的 MCP 设置窗口重新生成。

## Upgrade note / 升级说明

The first v0.2.2 launch replaces the previous process-only generated token with a persistent local token. Copy the MCP connection configuration once after upgrading. Later ordinary restarts do not require copying it again; manually regenerating the token invalidates existing clients immediately.

首次启动 v0.2.2 时会用持久化本机 Token 替代旧的进程内临时 Token。升级后只需复制一次 MCP 连接配置；之后普通重启无需重复复制，手动重新生成会立即使已有客户端失效。

## Asset expansion / 素材扩充

README now documents the supported paths for personal imports, watched folders, bundled sound effects, music-library design, templates, LUTs, transitions, effects, and redistribution licensing.

README 已补充个人导入、监听文件夹、内置音效、音乐库设计、模板、LUT、转场、特效以及再分发许可证要求。
