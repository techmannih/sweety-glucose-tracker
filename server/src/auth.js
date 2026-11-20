import { Router } from 'express';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import { rateLimit } from 'express-rate-limit';
import { HttpError } from './errors.js';
import { normalizeEmail, SIGNUP_SUCCESS_MESSAGE, validateAuth } from '../../shared/auth.js';

const COOKIE = 'sweety_session';
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const digest = (token) => createHash('sha256').update(token).digest('hex');
// Keep unknown-email and incorrect-password paths on the same bcrypt work factor.
const dummyHash = bcrypt.hashSync('unused-login-timing-value', 12);
const cookieOptions = (config) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.secure,
  path: '/',
});

async function sessionToken(db, userId) {
  const token = randomBytes(32).toString('hex');
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now() + interval '7 days')",
    [digest(token), userId],
  );
  await db.query('DELETE FROM sessions WHERE expires_at <= now()');
  return token;
}

export function requireUser(pool) {
  return async (req, res, next) => {
    const token = req.cookies[COOKIE];
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw new HttpError(401, 'Please log in to continue.');
    const { rows } = await pool.query(
      'SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > now()',
      [digest(token)],
    );
    if (!rows.length) throw new HttpError(401, 'Your session has expired. Please log in again.');
    req.user = rows[0];
    next();
  };
}

export function authRouter(pool, config, limitAuth = true) {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Too many attempts. Please try again in 15 minutes.' },
  });
  if (limitAuth) router.use(['/register', '/login'], limiter);

  router.post('/register', async (req, res) => {
    const { name, email, password } = req.body || {};
    const fields = validateAuth({ name, email, password }, { register: true });
    if (Object.keys(fields).length)
      throw new HttpError(400, 'Please check the highlighted fields.', fields);
    const user = { id: randomUUID(), name: name.trim(), email: normalizeEmail(email) };
    const hash = await bcrypt.hash(password, 12);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO users(id,name,email,password_hash) VALUES ($1,$2,$3,$4)', [
        user.id,
        user.name,
        user.email,
        hash,
      ]);
      await client.query('COMMIT');
      // Registration only creates the account. A separate login is required.
      res.status(201).json({ message: SIGNUP_SUCCESS_MESSAGE });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505')
        throw new HttpError(409, 'An account with this email already exists.', {
          email: 'An account with this email already exists.',
        });
      throw error;
    } finally {
      client.release();
    }
  });

  router.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    const fields = validateAuth({ email, password });
    if (Object.keys(fields).length)
      throw new HttpError(400, 'Please check the highlighted fields.', fields);
    const { rows } = await pool.query(
      'SELECT id,name,email,password_hash FROM users WHERE email=$1',
      [normalizeEmail(email)],
    );
    const user = rows[0];
    const matches = await bcrypt.compare(password, user?.password_hash || dummyHash);
    if (!user || !matches) throw new HttpError(401, 'Email or password is incorrect.');
    const token = await sessionToken(pool, user.id);
    const oldToken = req.cookies[COOKIE];
    if (oldToken && /^[a-f0-9]{64}$/.test(oldToken))
      await pool.query('DELETE FROM sessions WHERE token_hash=$1', [digest(oldToken)]);
    const { password_hash, ...safeUser } = user;
    res
      .cookie(COOKIE, token, { ...cookieOptions(config), maxAge: MAX_AGE })
      .json({ user: safeUser });
  });
  router.post('/logout', async (req, res) => {
    const token = req.cookies[COOKIE];
    if (token && /^[a-f0-9]{64}$/.test(token))
      await pool.query('DELETE FROM sessions WHERE token_hash=$1', [digest(token)]);
    res.clearCookie(COOKIE, cookieOptions(config)).status(204).end();
  });
  router.get('/me', requireUser(pool), (req, res) => res.json({ user: req.user }));
  return router;
}
