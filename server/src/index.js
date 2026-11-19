import pg from 'pg';
import { createApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
if (!config.databaseUrl) throw new Error('DATABASE_URL is required. Copy .env.example to .env and run npm run db:migrate.');
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 5000 });
pool.on('error', (error) => console.error('Database connection error:', error.code));
await pool.query('SELECT 1 FROM users LIMIT 1');
const server = createApp(pool, config).listen(config.port, config.host, () => console.log(`Sweety API: http://${config.host}:${config.port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(async () => { await pool.end(); process.exit(0); });
});
