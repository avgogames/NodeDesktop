/**
 * Formatting helpers shared by all views. Pure functions, unit-tested in
 * test/renderer.test.js.
 */

const IEC_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

/** 1536 -> "1.5 KiB". Uses binary (IEC) units like GNOME. */
export function formatBytes(bytes, { decimals = 1 } = {}) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return 'N/A';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < IEC_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : decimals)} ${IEC_UNITS[unit]}`;
}

/** Bytes per second -> "1.5 MiB/s". */
export function formatRate(bytesPerSecond) {
  if (bytesPerSecond === null || bytesPerSecond === undefined) return 'N/A';
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatPercent(value, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return `${value.toFixed(decimals)}%`;
}

/** Seconds of CPU time -> "1:02:03.45" / "2:03.45". */
export function formatCpuTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Map a nice value to GNOME's priority names. */
export function priorityLabel(nice) {
  if (nice <= -8) return 'Very High';
  if (nice <= -3) return 'High';
  if (nice <= 2) return 'Normal';
  if (nice <= 7) return 'Low';
  return 'Very Low';
}

export const PRIORITY_PRESETS = [
  { label: 'Very High', nice: -20 },
  { label: 'High', nice: -5 },
  { label: 'Normal', nice: 0 },
  { label: 'Low', nice: 5 },
  { label: 'Very Low', nice: 19 },
];

const STATE_NAMES = {
  R: 'Running',
  S: 'Sleeping',
  D: 'Uninterruptible',
  Z: 'Zombie',
  T: 'Stopped',
  t: 'Tracing stop',
  X: 'Dead',
  I: 'Idle',
  P: 'Parked',
};

export function stateLabel(state) {
  return STATE_NAMES[state] ?? state ?? 'Unknown';
}

export function formatDate(ms) {
  if (!ms) return 'N/A';
  return new Date(ms).toLocaleString();
}

/** Escape text for safe interpolation into innerHTML. */
export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
