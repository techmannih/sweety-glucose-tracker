export const SLOTS = [
  {
    value: 'morning',
    label: 'Morning (fasting)',
    short: 'Morning',
    hint: 'Before your first meal',
  },
  {
    value: 'after_breakfast',
    label: 'After breakfast',
    short: 'Breakfast',
    hint: 'Your breakfast reading',
  },
  { value: 'after_lunch', label: 'After lunch', short: 'Lunch', hint: 'Your lunch reading' },
  { value: 'after_dinner', label: 'After dinner', short: 'Dinner', hint: 'Your dinner reading' },
];

export const WHOLE_GLUCOSE_VALUE_ERROR = 'Value must be a whole number between 40 and 600 mg/dl.';

export function todayInZone(timeZone = 'Asia/Kolkata', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '1900-01-01')
    return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function validateReading(input, today) {
  const errors = {};
  if (!validDate(input.date)) errors.date = 'Please choose a valid date (1900 or later).';
  else if (input.date > today) errors.date = 'Date cannot be in the future.';
  if (!SLOTS.some((s) => s.value === input.slot))
    errors.slot = 'Please choose one of the four time slots.';
  if (input.value === '' || input.value === null || input.value === undefined) {
    errors.value = 'Please enter a glucose value.';
  } else if (
    !['number', 'string'].includes(typeof input.value) ||
    !/^\d+$/.test(String(input.value)) ||
    !Number.isInteger(Number(input.value)) ||
    Number(input.value) < 40 ||
    Number(input.value) > 600
  ) {
    errors.value = WHOLE_GLUCOSE_VALUE_ERROR;
  }
  return errors;
}

export function reportRange(kind, date) {
  if (kind === 'daily') return { start: date, end: date };
  if (kind === 'month-to-date') return { start: `${date.slice(0, 7)}-01`, end: date };
  if (kind !== 'monthly') throw new Error('Invalid report kind');
  const first = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  first.setUTCDate(0);
  const end = first.toISOString().slice(0, 10);
  return { start: `${end.slice(0, 7)}-01`, end };
}

export function displayDate(date, options = {}) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
    ...options,
  });
}
