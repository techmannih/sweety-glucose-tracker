import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { todayInZone, SLOTS, reportRange } from '../../shared/domain.js';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL first.');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const email = (process.env.DEMO_EMAIL || 'demo@sweety.local').toLowerCase();
const password = process.env.DEMO_PASSWORD || 'SweetyDemo2026!';
if (password.length < 8 || Buffer.byteLength(password) > 72)
  throw new Error('DEMO_PASSWORD must be 8 characters or more, and at most 72 UTF-8 bytes.');
const today = todayInZone(process.env.APP_TIMEZONE || 'Asia/Kolkata');
const client = await pool.connect();
try {
  await client.query('BEGIN');
  let user = (await client.query('SELECT id FROM users WHERE email=$1', [email])).rows[0];
  if (!user) {
    user = { id: randomUUID() };
    await client.query('INSERT INTO users(id,name,email,password_hash) VALUES ($1,$2,$3,$4)', [
      user.id,
      'Alex Morgan',
      email,
      await bcrypt.hash(password, 12),
    ]);
  }
  const first = reportRange('monthly', today).start;
  const cursor = new Date(`${first}T00:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= today) {
    const date = cursor.toISOString().slice(0, 10);
    const day = cursor.getUTCDate();
    for (let i = 0; i < SLOTS.length; i++) {
      if (date === today && i > 1) continue;
      const value = [96, 128, 136, 118][i] + ((day * 7 + i * 3) % 23) - 11;
      await client.query(
        'INSERT INTO readings(id,user_id,date,slot,value) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id,date,slot) DO NOTHING',
        [randomUUID(), user.id, date, SLOTS[i].value, value],
      );
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  await client.query('COMMIT');
  console.log(`Demo data ready for ${email}. Existing passwords and readings were preserved.`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
