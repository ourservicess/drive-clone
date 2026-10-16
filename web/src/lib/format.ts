export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const sameYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const otherYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const full = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** "3:41 PM" for today, "Mar 4" this year, "Mar 4, 2024" otherwise. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return timeOnly.format(date);
  return date.getFullYear() === now.getFullYear() ? sameYear.format(date) : otherYear.format(date);
}

export function formatDateTime(iso: string): string {
  return full.format(new Date(iso));
}

export function describeType(mimeType: string, name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : '';
  if (mimeType.startsWith('image/')) return `${ext} image`;
  if (mimeType.startsWith('video/')) return `${ext} video`;
  if (mimeType.startsWith('audio/')) return `${ext} audio`;
  if (mimeType === 'application/pdf') return 'PDF document';
  if (mimeType.startsWith('text/')) return `${ext || 'Text'} file`;
  return ext ? `${ext} file` : 'File';
}
