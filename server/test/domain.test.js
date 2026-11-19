import test from 'node:test';
import assert from 'node:assert/strict';
import { reportRange, todayInZone, validDate, validateReading } from '../../shared/domain.js';

test('report ranges handle month ends, leap years and a January year boundary', () => {
  assert.deepEqual(reportRange('daily', '2026-10-15'), { start: '2026-10-15', end: '2026-10-15' });
  assert.deepEqual(reportRange('month-to-date', '2026-10-15'), { start: '2026-10-01', end: '2026-10-15' });
  assert.deepEqual(reportRange('monthly', '2026-10-15'), { start: '2026-09-01', end: '2026-09-30' });
  assert.deepEqual(reportRange('monthly', '2026-01-03'), { start: '2025-12-01', end: '2025-12-31' });
  assert.deepEqual(reportRange('monthly', '2024-03-01'), { start: '2024-02-01', end: '2024-02-29' });
});
test('dates are calendar dates, not UTC offsets or JavaScript rollover dates', () => {
  assert.equal(todayInZone('Asia/Kolkata', new Date('2026-11-18T20:00:00Z')), '2026-11-19');
  for (const date of ['2026-02-29', '2026-04-31', '2026-1-01', '1899-12-31', 'bad', undefined]) assert.equal(validDate(date), false);
  assert.equal(validDate('2024-02-29'), true);
});
test('shared validation rejects missing, fractional, out-of-range and coercible non-numeric values', () => {
  for (const value of ['', null, undefined, 39, 601, 120.5, '1e2', '100.0', ' ', true, [100], {}]) {
    assert.ok(validateReading({ date: '2026-10-15', slot: 'morning', value }, '2026-10-15').value);
  }
  for (const value of [40, 600, '100']) assert.deepEqual(validateReading({ date: '2026-10-15', slot: 'morning', value }, '2026-10-15'), {});
  assert.equal(validateReading({ date: '2026-10-16', slot: 'morning', value: 100 }, '2026-10-15').date, 'Date cannot be in the future.');
});
