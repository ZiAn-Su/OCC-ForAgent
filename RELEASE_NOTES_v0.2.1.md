# OCC-ForAgent v0.2.1

OCC-ForAgent is an agent-focused distribution based on OpenChatCut v0.2.0. It remains licensed under AGPL-3.0-or-later and preserves the upstream attribution.

OCC-ForAgent 是基于 OpenChatCut v0.2.0 的 Agent 专用增强发行版，继续采用 AGPL-3.0-or-later，并保留上游署名。

## Highlights / 主要更新

- End-to-end MCP editing: create or target a project, import absolute local media paths, place assets on the timeline, edit, render, wait, and copy the completed video to a requested local path.
- MCP 全流程剪辑：创建或选择工程、导入本地绝对路径素材、落入时间线、执行剪辑、渲染、等待并复制成片到指定本地路径。
- Verified with a real installed Windows application: imported MP4, trimmed to 90 frames, split at frame 45, and exported H.264 at 854×480 / 30 FPS.
- 已在真实 Windows 安装版验证：导入 MP4、裁到 90 帧、在第 45 帧切分，并导出 854×480 / 30 FPS 的 H.264 视频。
- Fixed Windows project-store guard recovery, exact preset export dimensions, packaged FFmpeg fallback, and the editor Home button when a stale save blocks navigation.
- 修复 Windows 工程锁恢复、预设导出尺寸、安装版 FFmpeg 回退，以及版本冲突阻止主页返回的问题。

## Compatibility / 兼容性

- The desktop executable and user-data directories retain the OpenChatCut names in v0.2.1, so an existing v0.2.0 installation can be upgraded without migrating projects.
- v0.2.1 保留 OpenChatCut 的桌面程序名与用户数据目录，可从既有 v0.2.0 安装直接升级，无需迁移工程。
- MCP clients should copy the current token from **Settings → MCP** after installation or restart.
- 安装或重启后，请从 **设置 → MCP** 复制当前 Token 配置到 MCP 客户端。

## License / 许可证

The source and modifications are distributed under AGPL-3.0-or-later. Third-party components, fonts, models, and user-provided media remain subject to their own licenses.

源码及修改继续按 AGPL-3.0-or-later 分发；第三方组件、字体、模型及用户素材仍分别遵循其自身许可证。
