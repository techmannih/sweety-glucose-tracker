import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { HttpError } from './errors.js';
import {
  SLOTS,
  WHOLE_GLUCOSE_VALUE_ERROR,
  validateReading,
  validDate,
  todayInZone,
} from '../../shared/domain.js';

export const SLOT_ORDER =
  "CASE slot WHEN 'morning' THEN 1 WHEN 'after_breakfast' THEN 2 WHEN 'after_lunch' THEN 3 ELSE 4 END";
const columns = 'id, date::text, slot, value';
const readingValueSources = new WeakMap();

// JSON.parse can round a fractional literal to an integer before validation sees it.
export function captureReadingValueSource(key, value, { source } = {}) {
  if (key === 'value' && typeof value === 'number') readingValueSources.set(this, source);
  return value;
}

function isExactWholeNumber(source) {
  const token = /^-?(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(source);
  if (!token) return false;
  const [, whole, fraction = '', exponent = '0'] = token;
  const fractionalPlaces = fraction.length - Number(exponent);
  if (fractionalPlaces <= 0) return true;
  const digits = whole + fraction;
  // Shift the decimal point conceptually so extreme exponents need no allocation.
  return fractionalPlaces <= digits.length && !/[1-9]/.test(digits.slice(-fractionalPlaces));
}

function requireId(id) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))
    throw new HttpError(404, 'Reading not found.');
}
function positiveInteger(value, fallback, max) {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > max
  )
    throw new HttpError(400, `Pagination values must be positive whole numbers (maximum ${max}).`);
  return Number(value);
}

export function readingsRouter(pool, config) {
  const router = Router();
  router.get('/', async (req, res) => {
    if (Object.keys(req.query).some((key) => !['page', 'limit', 'date'].includes(key)))
      throw new HttpError(400, 'Supported query parameters are page, limit, and date.');
    const page = positiveInteger(req.query.page, 1, 1000000);
    const limit = positiveInteger(req.query.limit, 20, 100);
    const params = [req.user.id];
    let where = 'user_id=$1';
    if (req.query.date !== undefined) {
      if (!validDate(req.query.date)) throw new HttpError(400, 'Please choose a valid date.');
      params.push(req.query.date);
      where += ' AND date=$2';
    }
    const order = `date DESC, ${SLOT_ORDER}, id`;
    // The count and page share one PostgreSQL statement snapshot, even for an empty page.
    const {
      rows: [result],
    } = await pool.query(
      `WITH reading_page AS (
         SELECT id, date, slot, value FROM readings WHERE ${where}
         ORDER BY ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}
       )
       SELECT (SELECT count(*)::int FROM readings WHERE ${where}) AS total,
         COALESCE(json_agg(json_build_object('id', id, 'date', date::text, 'slot', slot, 'value', value)
                           ORDER BY ${order}), '[]'::json) AS readings
       FROM reading_page`,
      [...params, limit, (page - 1) * limit],
    );
    res.json({ ...result, page, limit });
  });

  async function save(req, res, editing) {
    if (editing) requireId(req.params.id);
    const input = req.body || {};
    const fields = validateReading(input, todayInZone(config.timeZone));
    if (
      !fields.value &&
      typeof input.value === 'number' &&
      !isExactWholeNumber(readingValueSources.get(input))
    )
      fields.value = WHOLE_GLUCOSE_VALUE_ERROR;
    if (Object.keys(fields).length) throw new HttpError(400, Object.values(fields)[0], fields);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize creates and updates by account. The SQL unique constraint is the final guard.
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
      if (editing) {
        const owned = await client.query('SELECT id FROM readings WHERE id=$1 AND user_id=$2', [
          req.params.id,
          req.user.id,
        ]);
        if (!owned.rowCount) throw new HttpError(404, 'Reading not found.');
      }
      const { rows: existing } = await client.query(
        'SELECT slot FROM readings WHERE user_id=$1 AND date=$2 AND ($3::uuid IS NULL OR id<>$3)',
        [req.user.id, input.date, editing ? req.params.id : null],
      );
      if (existing.some((r) => r.slot === input.slot)) {
        const label = SLOTS.find((s) => s.value === input.slot).label;
        throw new HttpError(409, `You already have a ${label} reading for this date.`, {
          slot: `You already have a ${label} reading for this date.`,
        });
      }
      if (existing.length >= 4) throw new HttpError(409, 'You can add only 4 readings per day.');
      const id = editing ? req.params.id : randomUUID();
      const result = editing
        ? await client.query(
            `UPDATE readings SET date=$1,slot=$2,value=$3,updated_at=now() WHERE id=$4 AND user_id=$5 RETURNING ${columns}`,
            [input.date, input.slot, Number(input.value), id, req.user.id],
          )
        : await client.query(
            `INSERT INTO readings(id,user_id,date,slot,value) VALUES ($1,$2,$3,$4,$5) RETURNING ${columns}`,
            [id, req.user.id, input.date, input.slot, Number(input.value)],
          );
      // A concurrent delete can commit after the ownership check above.
      if (editing && !result.rowCount) throw new HttpError(404, 'Reading not found.');
      await client.query('COMMIT');
      res.status(editing ? 200 : 201).json({ reading: result.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  router.post('/', (req, res) => save(req, res, false));
  router.put('/:id', (req, res) => save(req, res, true));
  router.delete('/:id', async (req, res) => {
    requireId(req.params.id);
    const result = await pool.query('DELETE FROM readings WHERE id=$1 AND user_id=$2', [
      req.params.id,
      req.user.id,
    ]);
    if (!result.rowCount) throw new HttpError(404, 'Reading not found.');
    res.status(204).end();
  });
  return router;
}
