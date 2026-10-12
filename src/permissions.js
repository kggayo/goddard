// Normalize explicit invocation options; never infer access from a saved handoff.
export function resolvePermissions({ provider = 'codex', readOnly = false, bypassPermissions = false, claudePermissionMode } = {}) {
  if (!['codex', 'claude'].includes(provider)) throw new Error('--agent must be codex or claude.');
  if (provider !== 'claude' && claudePermissionMode !== undefined) throw new Error('--claude-permission-mode requires --agent claude.');
  if (claudePermissionMode !== undefined && !['acceptEdits', 'auto', 'bypassPermissions'].includes(claudePermissionMode)) {
    throw new Error('--claude-permission-mode must be acceptEdits, auto, or bypassPermissions.');
  }
  if (bypassPermissions && claudePermissionMode !== undefined && claudePermissionMode !== 'bypassPermissions') {
    throw new Error('--dangerously-skip-permissions conflicts with the selected --claude-permission-mode.');
  }
  const bypass = Boolean(bypassPermissions || claudePermissionMode === 'bypassPermissions');
  if (readOnly && bypass) throw new Error('--read-only cannot be combined with permission bypass.');
  return { bypassPermissions: bypass,
    ...(provider === 'claude' ? { claudePermissionMode: bypass ? 'bypassPermissions' : claudePermissionMode ?? 'acceptEdits' } : {}) };
}
