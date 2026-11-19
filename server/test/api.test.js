import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { migrate } from '../db/migrate.js';

const config = {
  origin: 'http://localhost:5173',
  secure: false,
  timeZone: 'Asia/Kolkata',
  serveClient: false,
};
const databaseName = `sweety_test_${randomUUID().replaceAll('-', '')}`;
let pool, admin, embedded, directory, app;
const headers = { Origin: config.origin };
const reading = (slot = 'morning', value = 100, date = '2024-10-15') => ({ date, slot, value });
async function account(email = `${randomUUID()}@example.test`) {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/auth/register')
    .set(headers)
    .send({ name: 'Test User', email, password: 'TestPassword123!' });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return {
    agent,
    user: response.body.user,
    cookie: response.headers['set-cookie'][0].split(';')[0],
  };
}

before(async () => {
  let connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    directory = await mkdtemp('/tmp/sweety-test-');
    const probe = createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    embedded = new EmbeddedPostgres({
      databaseDir: directory,
      user: 'sweety_test',
      password: 'test_only',
      port,
      persistent: false,
      autoRehydrateSymlinks: true,
      authMethod: 'scram-sha-256',
      postgresFlags: ['-h', '127.0.0.1', '-k', directory],
      onLog: () => {},
      onError: () => {},
    });
    await embedded.initialise();
    await embedded.start();
    connectionString = `postgres://sweety_test:test_only@127.0.0.1:${port}/postgres`;
  }
  admin = new pg.Client({ connectionString });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  pool = new pg.Pool({ connectionString: url.toString() });
  await migrate(pool);
  await migrate(pool);
  app = createApp(pool, config, { limitAuth: false });
});
beforeEach(async () => {
  await pool.query('TRUNCATE users CASCADE');
});
after(async () => {
  await pool?.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
  if (embedded) await embedded.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('registration hashes the password and session token, normalizes email, and sets an HttpOnly cookie', async () => {
  const { user, cookie, agent } = await account('MixedCase@Example.Test');
  assert.equal(user.email, 'mixedcase@example.test');
  assert.equal(user.password_hash, undefined);
  const stored = (await pool.query('SELECT password_hash FROM users WHERE id=$1', [user.id]))
    .rows[0].password_hash;
  assert.match(stored, /^\$2[aby]\$12\$/);
  assert.ok(await bcrypt.compare('TestPassword123!', stored));
  const tokenHash = (await pool.query('SELECT token_hash FROM sessions')).rows[0].token_hash;
  assert.notEqual(tokenHash, cookie.split('=')[1]);
  const login = await agent
    .post('/api/auth/login')
    .set(headers)
    .send({ email: user.email, password: 'TestPassword123!' });
  assert.match(login.headers['set-cookie'][0], /HttpOnly/);
  assert.match(login.headers['set-cookie'][0], /SameSite=Lax/);
  const duplicate = await request(app)
    .post('/api/auth/register')
    .set(headers)
    .send({ name: 'Another', email: 'MIXEDCASE@example.test', password: 'OtherPassword123!' });
  assert.equal(duplicate.status, 409);
});

test('registration rejects invalid fields and passwords exceeding bcrypt UTF-8 limits', async () => {
  const response = await request(app)
    .post('/api/auth/register')
    .set(headers)
    .send({ name: ' ', email: 'invalid', password: '🙂'.repeat(19) });
  assert.equal(response.status, 400);
  assert.deepEqual(Object.keys(response.body.fields).sort(), ['email', 'name', 'password']);
  assert.equal((await pool.query('SELECT count(*) FROM users')).rows[0].count, '0');
});

test('login uses generic errors, logout revokes the token, and expired sessions cannot read data', async () => {
  const { agent, user, cookie } = await account();
  const bad = await agent
    .post('/api/auth/login')
    .set(headers)
    .send({ email: user.email, password: 'incorrect' });
  const unknown = await agent
    .post('/api/auth/login')
    .set(headers)
    .send({ email: 'missing@example.test', password: 'incorrect' });
  assert.equal(bad.status, 401);
  assert.deepEqual(bad.body, unknown.body);
  await agent.post('/api/auth/logout').set(headers).expect(204);
  await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
  await agent
    .post('/api/auth/login')
    .set(headers)
    .send({ email: user.email, password: 'TestPassword123!' })
    .expect(200);
  await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second'");
  await agent.get('/api/readings').expect(401);
});

test('unauthenticated reads and cross-origin writes are rejected', async () => {
  await request(app).get('/api/readings').expect(401);
  await request(app).get('/api/reports').expect(401);
  const { agent } = await account();
  await agent
    .post('/api/readings')
    .set('Origin', 'https://untrusted.example')
    .send(reading())
    .expect(403);
  await agent.post('/api/readings').send(reading()).expect(403);
});

test('readings can be created, edited without self-conflict, moved and deleted', async () => {
  const { agent } = await account();
  const created = await agent.post('/api/readings').set(headers).send(reading()).expect(201);
  const id = created.body.reading.id;
  const edited = await agent
    .put(`/api/readings/${id}`)
    .set(headers)
    .send(reading('morning', 140))
    .expect(200);
  assert.equal(edited.body.reading.value, 140);
  await agent
    .put(`/api/readings/${id}`)
    .set(headers)
    .send(reading('after_lunch', 120, '2024-10-16'))
    .expect(200);
  const list = await agent.get('/api/readings').expect(200);
  assert.equal(list.body.readings[0].date, '2024-10-16');
  await agent.delete(`/api/readings/${id}`).set(headers).expect(204);
  await agent.delete(`/api/readings/${id}`).set(headers).expect(404);
  assert.equal((await agent.get('/api/readings')).body.total, 0);
});

test('API validation rejects malformed bodies, future dates, invalid slots and non-integer values', async () => {
  const { agent } = await account();
  for (const body of [
    { ...reading(), value: '' },
    { ...reading(), value: 39 },
    { ...reading(), value: 601 },
    { ...reading(), value: 100.1 },
    { ...reading(), value: true },
    { ...reading(), value: [100] },
    { ...reading(), slot: 'bedtime' },
    { ...reading(), date: '2099-01-01' },
    { ...reading(), date: '2024-02-30' },
    {},
  ]) {
    const response = await agent.post('/api/readings').set(headers).send(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.ok(response.body.message);
  }
  await agent
    .post('/api/readings')
    .set(headers)
    .set('Content-Type', 'application/json')
    .send('{')
    .expect(400);
  await agent.post('/api/readings').set(headers).send(reading('morning', 40)).expect(201);
  await agent.post('/api/readings').set(headers).send(reading('after_dinner', 600)).expect(201);
});

test('four slots enforce the daily maximum; concurrent duplicates produce exactly one reading', async () => {
  const { agent } = await account();
  const attempts = await Promise.all(
    Array.from({ length: 6 }, () => agent.post('/api/readings').set(headers).send(reading())),
  );
  assert.equal(attempts.filter((r) => r.status === 201).length, 1);
  assert.equal(attempts.filter((r) => r.status === 409).length, 5);
  for (const slot of ['after_breakfast', 'after_lunch', 'after_dinner'])
    await agent.post('/api/readings').set(headers).send(reading(slot)).expect(201);
  await agent.post('/api/readings').set(headers).send(reading('after_lunch')).expect(409);
  assert.equal((await agent.get('/api/readings')).body.total, 4);
});

test('editing into an occupied slot fails and preserves the original reading', async () => {
  const { agent } = await account();
  const first = await agent.post('/api/readings').set(headers).send(reading()).expect(201);
  await agent.post('/api/readings').set(headers).send(reading('after_lunch', 150)).expect(201);
  await agent
    .put(`/api/readings/${first.body.reading.id}`)
    .set(headers)
    .send(reading('after_lunch', 200))
    .expect(409);
  const list = await agent.get('/api/readings');
  assert.equal(list.body.readings.find((r) => r.slot === 'morning').value, 100);
});

test('another account cannot list, report, edit or delete someone else’s readings', async () => {
  const owner = await account();
  const other = await account();
  const created = await owner.agent.post('/api/readings').set(headers).send(reading()).expect(201);
  const id = created.body.reading.id;
  assert.equal((await other.agent.get('/api/readings')).body.total, 0);
  assert.equal(
    (await other.agent.get('/api/reports?kind=daily&date=2024-10-15')).body.stats.count,
    0,
  );
  await other.agent.put(`/api/readings/${id}`).set(headers).send(reading()).expect(404);
  await other.agent.delete(`/api/readings/${id}`).set(headers).expect(404);
  assert.equal((await owner.agent.get('/api/readings')).body.total, 1);
});

test('reports include the exact period boundaries and round averages to one decimal', async () => {
  const { agent } = await account();
  for (const body of [
    reading('morning', 600, '2024-08-31'),
    reading('morning', 90, '2024-09-01'),
    reading('morning', 130, '2024-09-30'),
    reading('morning', 100, '2024-10-01'),
    reading('morning', 101),
    reading('after_lunch', 104),
    reading('morning', 500, '2024-10-16'),
  ])
    await agent.post('/api/readings').set(headers).send(body).expect(201);
  const daily = (await agent.get('/api/reports?kind=daily&date=2024-10-15')).body;
  assert.deepEqual(daily.stats, { lowest: 101, highest: 104, average: 102.5, count: 2 });
  assert.deepEqual(
    daily.readings.map((r) => r.slot),
    ['morning', 'after_lunch'],
  );
  const mtd = (await agent.get('/api/reports?kind=month-to-date&date=2024-10-15')).body;
  assert.deepEqual(mtd.stats, { lowest: 100, highest: 104, average: 101.7, count: 3 });
  const monthly = (await agent.get('/api/reports?kind=monthly&date=2024-10-15')).body;
  assert.deepEqual(monthly.stats, { lowest: 90, highest: 130, average: 110, count: 2 });
  assert.equal(monthly.start, '2024-09-01');
  assert.equal(monthly.end, '2024-09-30');
});

test('empty reports return null statistics and zero count, and invalid report queries fail', async () => {
  const { agent } = await account();
  const report = (await agent.get('/api/reports?kind=daily&date=2024-10-15')).body;
  assert.deepEqual(report.stats, { lowest: null, highest: null, average: null, count: 0 });
  assert.deepEqual(report.readings, []);
  await agent.get('/api/reports?kind=weekly').expect(400);
  await agent.get('/api/reports?date=2099-01-01').expect(400);
  await agent.get('/api/reports?date=2024-02-30').expect(400);
});

test('pagination has deterministic slot order, counts, date filters, and validated bounds', async () => {
  const { agent } = await account();
  for (const slot of ['after_lunch', 'morning', 'after_dinner', 'after_breakfast'])
    await agent.post('/api/readings').set(headers).send(reading(slot));
  const page = (await agent.get('/api/readings?page=2&limit=2')).body;
  assert.equal(page.total, 4);
  assert.deepEqual(
    page.readings.map((r) => r.slot),
    ['after_lunch', 'after_dinner'],
  );
  assert.equal((await agent.get('/api/readings?date=2024-10-16')).body.total, 0);
  for (const query of ['page=0', 'page=1.5', 'limit=101', 'limit=-1', 'date=bad', 'page[]=1'])
    await agent.get(`/api/readings?${query}`).expect(400);
});

test('database constraints independently reject duplicate slots and invalid glucose values', async () => {
  const { user } = await account();
  const insert = (slot, value) =>
    pool.query('INSERT INTO readings(id,user_id,date,slot,value) VALUES ($1,$2,$3,$4,$5)', [
      randomUUID(),
      user.id,
      '2024-10-15',
      slot,
      value,
    ]);
  await insert('morning', 100);
  await assert.rejects(insert('morning', 100), { code: '23505' });
  await assert.rejects(insert('bedtime', 100), { code: '23514' });
  await assert.rejects(insert('after_lunch', 601), { code: '23514' });
});
