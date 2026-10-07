export function codexUsage(result, time = Date.now()) {
  const buckets = result?.rateLimitsByLimitId ? Object.entries(result.rateLimitsByLimitId) : [['codex', result?.rateLimits]];
  return buckets.flatMap(([bucket, limits]) => ['primary', 'secondary'].flatMap(window => {
    const value = limits?.[window];
    return typeof value?.usedPercent === 'number' && Number.isFinite(value.usedPercent) ? [{ bucket, window,
      usedPercent: value.usedPercent, resetsAt: value.resetsAt ?? null, observedAt: time }] : [];
  }));
}
export function claudeUsage(result, time = Date.now()) {
  return ['five_hour', 'seven_day', 'spend_limit'].flatMap(window => {
    const value = result?.rate_limits?.[window];
    return typeof value?.used_percentage === 'number' && Number.isFinite(value.used_percentage) ? [{ bucket: 'claude', window,
      usedPercent: value.used_percentage, resetsAt: value.resets_at ?? null, observedAt: time }] : [];
  });
}
export function usageDecision(windows, { warn = 75, stop = 85, staleMs = 120000, time = Date.now() } = {}) {
  if (!(warn > 0 && warn < stop && stop <= 100)) throw new Error('Usage thresholds require 0 < warn < stop <= 100.');
  const fresh = windows.filter(window => window.observedAt <= time && time - window.observedAt < staleMs &&
    (window.resetsAt == null || window.resetsAt * 1000 > time));
  if (!fresh.length) return { action: 'unknown', usedPercent: null };
  const usedPercent = Math.max(...fresh.map(window => window.usedPercent));
  return { action: usedPercent >= stop ? 'drain' : usedPercent >= warn ? 'checkpoint' : 'continue', usedPercent };
}
