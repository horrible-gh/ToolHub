export function formatRelativeTime(value, now = Date.now()) {
  const then = Date.parse(value);
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + (minutes === 1 ? ' min ago' : ' mins ago');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
  const days = Math.round(hours / 24);
  return days + (days === 1 ? ' day ago' : ' days ago');
}

export function formatDuration(milliseconds) {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds)) return '';
  if (milliseconds < 1000) return Math.max(0, Math.round(milliseconds)) + 'ms';
  return (milliseconds / 1000).toFixed(milliseconds < 10000 ? 2 : 1) + 's';
}

export function truncate(value, limit = 60) {
  const text = String(value ?? '');
  return text.length <= limit ? text : text.slice(0, limit - 1) + '…';
}
