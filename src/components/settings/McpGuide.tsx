// Trusted editor guide for the authenticated Streamable HTTP endpoint.
import { useEffect, useState } from 'react';
import { editorBootstrapInfo, rotateEditorMcpToken } from '../../agent/editor-credential';
import type { EditorBootstrapInfo } from '../../../shared/editor-auth-transport';
import { theme } from '../../theme';
import { useT } from '../../i18n/locale';
import { Icon } from '../icons';

interface Snippet {
  label: string;
  code: string;
}

function snippets(endpoint: string, token: string): Snippet[] {
  return [
    {
      label: 'Claude Code',
      code: `claude mcp add --transport http -H "Authorization: Bearer ${token}" openchatcut ${endpoint}`,
    },
    {
      label: 'Codex',
      code: `export OPENCHATCUT_MCP_TOKEN='${token}'\\ncodex mcp add openchatcut --url ${endpoint} --bearer-token-env-var OPENCHATCUT_MCP_TOKEN`,
    },
    {
      label: 'Cursor (~/.cursor/mcp.json)',
      code: JSON.stringify({
        mcpServers: {
          openchatcut: {
            type: 'http',
            url: endpoint,
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      }, null, 2),
    },
  ];
}

function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      style={{
        flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 8px', border: `0.5px solid ${theme.border}`, borderRadius: 4,
        background: theme.hover, color: copied ? theme.accent : theme.textMuted,
        fontSize: 11, cursor: 'pointer',
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={11} />
      {copied ? t('已复制') : t('复制到剪贴板')}
    </button>
  );
}

export function McpGuideDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const endpoint = `${window.location.origin}/api/external-mcp/mcp`;
  const [mcpInfo, setMcpInfo] = useState<EditorBootstrapInfo | null>(null);
  const [tokenError, setTokenError] = useState(false);
  const [rotatingToken, setRotatingToken] = useState(false);
  useEffect(() => {
    let active = true;
    void editorBootstrapInfo().then(
      (info) => { if (active) setMcpInfo(info); },
      () => { if (active) setTokenError(true); },
    );
    return () => { active = false; };
  }, []);
  const rotateToken = async () => {
    if (!window.confirm(t('重新生成后，使用旧 Token 的智能体会立即断开。确定继续吗？'))) return;
    setRotatingToken(true);
    setTokenError(false);
    try {
      setMcpInfo(await rotateEditorMcpToken());
    } catch {
      setTokenError(true);
    } finally {
      setRotatingToken(false);
    }
  };
  const codeStyle: React.CSSProperties = {
    margin: 0, padding: '7px 9px', border: `0.5px solid ${theme.borderLight}`, borderRadius: 4,
    background: theme.inset, color: theme.text, fontSize: 11.5, lineHeight: 1.5,
    fontFamily: 'Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
    whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'text',
  };
  return (
    <div className="cc-modal-backdrop" onPointerDown={onClose}>
      <div
        className="cc-modal"
        style={{ width: 560, gap: 10, maxHeight: 'calc(100vh - 64px)', overflowY: 'auto' }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-start' }}>
          <Icon name="plug" size={15} />
          <strong style={{ fontSize: 14 }}>{t('外部 Agent 接入 (MCP)')}</strong>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto', padding: '3px 9px' }}>{t('关闭')}</button>
        </div>
        <div style={{ color: theme.textMuted, fontSize: 12, lineHeight: 1.55 }}>
          {t('OpenChatCut 暴露一个 Streamable HTTP MCP 端点。Claude Code / Codex / Cursor 等外部 Agent 接入后,与内置 Agent 共用同一套编辑工具,可直接读写当前工程。')}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{t('内置 Agent 与外部 MCP')}</span>
          <div style={{ color: theme.textMuted, fontSize: 12, lineHeight: 1.55 }}>
            {t('内置 Agent 会先生成可预览的修改提案，由你应用或拒绝；外部 MCP 使用独立编辑会话，manual 模式等待审核，auto 模式在 review 时直接应用。两者都只通过 EditorCore 命令修改工程。')}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{t('连接本地模型')}</span>
          <div style={{ color: theme.textMuted, fontSize: 12, lineHeight: 1.55 }}>
            {t('打开 设置 → Agent 模型 → Agent 大脑 → OpenAI，填写本地或兼容服务的 API URL 和模型；按服务选择 Responses API 或 Chat Completions API，再点“测试并读取模型”。仅在服务要求时填写 API Key。')}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-start' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{t('端点地址')}</span>
            <CopyButton text={endpoint} />
          </div>
          <pre style={codeStyle}>{endpoint}</pre>
        </div>

        {mcpInfo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              disabled={!mcpInfo.mcpTokenCanRotate || rotatingToken}
              onClick={() => { void rotateToken(); }}
              style={{ padding: '5px 10px' }}
            >
              {rotatingToken ? t('正在重新生成…') : t('重新生成 Token')}
            </button>
            {!mcpInfo.mcpTokenCanRotate && (
              <span style={{ color: theme.textDim, fontSize: 11.5 }}>
                {t('当前 Token 由 OPENCHATCUT_MCP_TOKEN 环境变量管理。')}
              </span>
            )}
          </div>
        )}

        {mcpInfo ? snippets(endpoint, mcpInfo.mcpToken).map((snippet) => (
          <div key={snippet.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-start' }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{snippet.label}</span>
              <CopyButton text={snippet.code} />
            </div>
            <pre style={codeStyle}>{snippet.code}</pre>
          </div>
        )) : (
          <div style={{ color: tokenError ? theme.danger : theme.textMuted, fontSize: 12 }}>
            {tokenError ? t('无法读取 MCP 连接令牌，请从受信任的编辑器窗口重试。') : t('正在读取 MCP 连接令牌…')}
          </div>
        )}

        <div style={{ color: theme.textDim, fontSize: 11.5, lineHeight: 1.55, borderTop: `0.5px solid ${theme.borderLight}`, paddingTop: 8 }}>
          {t('MCP Token 首次启动时自动生成，并保存在当前用户的私有配置目录中；重启后保持不变。重新生成会立即使旧 Token 失效。OPENCHATCUT_MCP_TOKEN 仍可覆盖本机 Token。')}
        </div>
      </div>
    </div>
  );
}
