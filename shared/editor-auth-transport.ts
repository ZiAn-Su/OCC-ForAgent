export const EDITOR_CREDENTIALS_CHANNEL = 'openchatcut:editor-credentials';

export interface EditorBootstrapInfo {
  mcpToken: string;
  /** Missing only when talking to an older desktop preload. */
  mcpTokenCanRotate?: boolean;
}
