import 'dotenv/config';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve('.local-db');
await mkdir(directory, { recursive: true });
const port = Number(process.env.LOCAL_DB_PORT || 5432);
const database = new EmbeddedPostgres({ databaseDir: directory, user: 'sweety', password: 'sweety_dev', port, persistent: true, authMethod: 'scram-sha-256', postgresFlags: ['-h', '127.0.0.1', '-k', directory], onLog: () => {}, onError: (message) => { if (String(message).includes('FATAL')) console.error(message); } });
try { await access(`${directory}/PG_VERSION`); } catch { await database.initialise(); }
await database.start();
const client = database.getPgClient();
await client.connect();
if (!(await client.query("SELECT 1 FROM pg_database WHERE datname='sweety'")).rowCount) await client.query('CREATE DATABASE sweety');
await client.end();
console.log(`Local PostgreSQL ready on 127.0.0.1:${port}. Keep this terminal open. Ctrl+C stops it; data stays in .local-db/.`);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (stopping) return; stopping = true; await database.stop(); process.exit(0); });
