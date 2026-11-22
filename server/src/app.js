import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { authRouter, requireUser } from './auth.js';
import { captureReadingValueSource, readingsRouter } from './readings.js';
import { reportsRouter } from './reports.js';
import { HttpError, errorHandler } from './errors.js';
import { todayInZone } from '../../shared/domain.js';

export function createApp(pool, config, { limitAuth = true } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '16kb', reviver: captureReadingValueSource }));
  app.use(cookieParser());
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== config.origin)
      throw new HttpError(
        403,
        'This request did not come from the app. Please refresh and try again.',
      );
    next();
  });
  app.get('/api/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  });
  app.get('/api/config', (req, res) =>
    res.json({ today: todayInZone(config.timeZone), timeZone: config.timeZone }),
  );
  app.use('/api/auth', authRouter(pool, config, limitAuth));
  app.use('/api/readings', requireUser(pool), readingsRouter(pool, config));
  app.use('/api/reports', requireUser(pool), reportsRouter(pool, config));
  app.use('/api', (req, res) => res.status(404).json({ message: 'Endpoint not found.' }));
  if (config.serveClient) {
    const dist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
    app.use(express.static(dist));
    app.get('/{*path}', (req, res) => res.sendFile(`${dist}/index.html`));
  }
  app.use(errorHandler);
  return app;
}
