import { Router } from 'express';
import { HttpError } from './errors.js';
import { reportRange, validDate, todayInZone } from '../../shared/domain.js';
import { SLOT_ORDER } from './readings.js';

export function reportsRouter(pool, config) {
  const router = Router();
  router.get('/', async (req, res) => {
    const { kind = 'daily', date = todayInZone(config.timeZone) } = req.query;
    if (!validDate(date) || date > todayInZone(config.timeZone))
      throw new HttpError(400, 'Select a valid date that is not in the future.');
    if (!['daily', 'month-to-date', 'monthly'].includes(kind))
      throw new HttpError(400, 'Report must be daily, month-to-date, or monthly.');
    const { start, end } = reportRange(kind, date);
    const { rows } = await pool.query(
      `SELECT
      min(value)::int AS lowest, max(value)::int AS highest,
      round(avg(value),1)::float8 AS average, count(*)::int AS count,
      COALESCE(json_agg(json_build_object('id',id,'date',date::text,'slot',slot,'value',value) ORDER BY date, ${SLOT_ORDER}), '[]'::json) AS readings
      FROM readings WHERE user_id=$1 AND date BETWEEN $2 AND $3`,
      [req.user.id, start, end],
    );
    const { readings, ...stats } = rows[0];
    res.json({ kind, start, end, stats, readings });
  });
  return router;
}
