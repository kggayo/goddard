// Normalize explicit invocation options to Goddard modes. Provider adapters own
// native permission settings; never infer access from a saved handoff.
export function resolvePermissions({ provider = 'codex', permissionMode, readOnly = false, bypassPermissions = false, claudePermissionMode } = {}) {
  if (!['codex', 'claude'].includes(provider)) throw new Error('--agent must be codex or claude.');
  if (permissionMode !== undefined && !['default', 'auto', 'read-only', 'bypass'].includes(permissionMode)) {
    throw new Error('--permission-mode must be default, auto, read-only, or bypass.');
  }
  // Compatibility input only: never pass a provider-specific mode to the runner.
  if (provider !== 'claude' && claudePermissionMode !== undefined) throw new Error('--claude-permission-mode requires --agent claude.');
  if (claudePermissionMode !== undefined && !['acceptEdits', 'auto', 'bypassPermissions'].includes(claudePermissionMode)) {
    throw new Error('--claude-permission-mode must be acceptEdits, auto, or bypassPermissions.');
  }
  const choices = [
    ['--permission-mode', permissionMode],
    ['--read-only', readOnly ? 'read-only' : undefined],
    ['--dangerously-skip-permissions', bypassPermissions ? 'bypass' : undefined],
    ['--claude-permission-mode', claudePermissionMode === undefined ? undefined : { acceptEdits: 'default', auto: 'auto', bypassPermissions: 'bypass' }[claudePermissionMode]]
  ].filter(([, mode]) => mode !== undefined);
  const [selectedFlag, mode] = choices[0] ?? ['--permission-mode', 'default'];
  for (const [flag, value] of choices.slice(1)) {
    if (value !== mode) throw new Error(`${selectedFlag} (${mode}) conflicts with ${flag} (${value}). Choose one permission mode.`);
  }
  return { permissionMode: mode, readOnly: mode === 'read-only', bypassPermissions: mode === 'bypass' };
}
