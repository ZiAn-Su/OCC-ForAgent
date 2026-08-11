export interface EditorLeaveOptions {
  flush: () => Promise<boolean>;
  confirmDiscard: () => boolean;
  leave: () => void;
}

/** Preserve normal autosave, but never trap the user in a stale editor forever. */
export async function leaveEditor(options: EditorLeaveOptions): Promise<'saved' | 'discarded' | 'cancelled'> {
  if (await options.flush()) {
    options.leave();
    return 'saved';
  }
  if (!options.confirmDiscard()) return 'cancelled';
  options.leave();
  return 'discarded';
}
