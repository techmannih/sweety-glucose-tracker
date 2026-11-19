import 'dotenv/config';

export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const timeZone = env.APP_TIMEZONE || 'Asia/Kolkata';
  new Intl.DateTimeFormat('en', { timeZone }).format();
  const origin = env.APP_ORIGIN || 'http://localhost:5173';
  if (new URL(origin).origin !== origin)
    throw new Error('APP_ORIGIN must be an origin without a path or trailing slash.');
  const secure = env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production;
  if (production && (!secure || !origin.startsWith('https://')))
    throw new Error('Production requires COOKIE_SECURE=true and an HTTPS APP_ORIGIN.');
  return {
    databaseUrl: env.DATABASE_URL,
    port: Number(env.PORT || 3001),
    host: env.HOST || '127.0.0.1',
    timeZone,
    origin,
    secure,
    serveClient: env.SERVE_CLIENT === 'true',
  };
}
