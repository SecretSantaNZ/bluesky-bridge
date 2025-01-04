import { format, formatRelative, parse } from 'date-fns';

export function parseDate(dateIso: string): Date {
  return parse(dateIso, 'yyyy-MM-dd', new Date());
}

export function formatDate(date: Date | string): string {
  return format(typeof date === 'string' ? parseDate(date) : date, 'do LLL');
}

export function formatDatetime(date: Date | string): string {
  return formatRelative(date, new Date());
}

export function formatDateIso(date: Date | string): string {
  return format(
    typeof date === 'string' ? parseDate(date) : date,
    'yyyy-MM-dd'
  );
}
