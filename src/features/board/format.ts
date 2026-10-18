import type { DateString, Priority } from '@shared/types';

/** Today's local calendar date as `YYYY-MM-DD`. */
export function today(): DateString {
  return new Date().toLocaleDateString('en-CA');
}

const SHORT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const LONG = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** `Oct 21`, or `Oct 21, 2027` outside the current year. */
export function formatDate(date: DateString): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return (d.getFullYear() === new Date().getFullYear() ? SHORT : LONG).format(d);
}

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });

/** `just now`, `5 min. ago`, `yesterday`, `Oct 3`. */
export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.round((t - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return 'just now';
  if (abs < 3600) return RTF.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return RTF.format(Math.round(s / 3600), 'hour');
  if (abs < 7 * 86400) return RTF.format(Math.round(s / 86400), 'day');
  return formatDate(new Date(t).toLocaleDateString('en-CA'));
}

export function absoluteTime(iso: string | undefined): string {
  return iso ? new Date(iso).toLocaleString() : '';
}

export const PRIORITY_NAMES: Record<Priority, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

