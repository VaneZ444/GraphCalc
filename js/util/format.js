export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function fmt(value, digits = 3) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞';
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor);
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}