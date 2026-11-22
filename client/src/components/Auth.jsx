import { useEffect, useState } from 'react';
import { Droplet, ShieldCheck, Activity, Sprout } from 'lucide-react';
import { api } from '../api.js';
import { normalizeEmail, SIGNUP_SUCCESS_MESSAGE, validateAuth } from '../../../shared/auth.js';
import SuccessToast, { SUCCESS_TOAST_MS } from './SuccessToast.jsx';

const LOGIN_NOTICE_MS = 1500;

export default function Auth({ onLogin, initialSuccess = '' }) {
  const [register, setRegister] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(initialSuccess);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const [pendingUser, setPendingUser] = useState(null);
  const waiting = busy || Boolean(pendingUser);
  useEffect(() => {
    if (!success || pendingUser) return;
    const timer = setTimeout(() => setSuccess(''), SUCCESS_TOAST_MS);
    return () => clearTimeout(timer);
  }, [success, pendingUser]);
  useEffect(() => {
    if (!pendingUser) return;
    const timer = setTimeout(() => {
      setSuccess('');
      setPendingUser(null);
      onLogin(pendingUser);
    }, LOGIN_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [pendingUser, onLogin]);
  async function submit(event) {
    event.preventDefault();
    if (waiting) return;
    setError('');
    const errors = validateAuth(form, { register });
    setFields(errors);
    if (Object.keys(errors).length) return;
    setBusy(true);
    setSuccess('');
    try {
      const result = await api(`/auth/${register ? 'register' : 'login'}`, {
        method: 'POST',
        body: { ...form, email: normalizeEmail(form.email) },
      });
      if (register) {
        setRegister(false);
        setSuccess(result.message || SIGNUP_SUCCESS_MESSAGE);
        setForm({ name: '', email: normalizeEmail(form.email), password: '' });
      } else {
        setSuccess('Login successful!');
        setForm((old) => ({ ...old, password: '' }));
        setPendingUser(result.user);
      }
    } catch (error) {
      setError(error.message);
      setFields(error.fields || {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <SuccessToast message={success} />
      <section className="auth-story">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Droplet size={25} />
          </span>
          sweety<span className="brand-period">.</span>
        </a>
        <div>
          <span className="eyebrow">A LITTLE CARE, EVERY DAY</span>
          <h1>
            Small check-ins.
            <br />A clearer picture.
          </h1>
          <p>
            A simple space for your glucose readings.
            <br />
            Build your journal, one day at a time.
          </p>
          <div className="auth-illustration" aria-hidden="true">
            <div className="illustration-card">
              <span>
                <Activity size={20} /> Daily journal
              </span>
              <div className="illustration-value">
                112 <small>mg/dl</small>
              </div>
              <svg viewBox="0 0 320 80">
                <path
                  d="M0 55 L35 38 L70 49 L110 25 L150 40 L190 18 L230 35 L270 28 L320 35"
                  fill="none"
                  stroke="#c7f18a"
                  strokeWidth="3"
                />
              </svg>
              <div className="illustration-slots">
                <span />
                <span />
                <span />
                <span className="unfilled" />
              </div>
            </div>
            <span className="leaf-badge">
              <Sprout size={32} />
            </span>
          </div>
        </div>
        <p className="auth-footer">
          <ShieldCheck size={18} /> Your journal. Your private space.
        </p>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-inner">
          <span className="eyebrow">WELCOME TO SWEETY</span>
          <h2>{register ? 'Start your journal.' : 'Good to see you.'}</h2>
          <p className="muted">
            {register
              ? 'Create an account to begin recording your readings.'
              : 'Log in and pick up where you left off.'}
          </p>
          <form onSubmit={submit} noValidate>
            {register && (
              <>
                <label htmlFor="name">Your name</label>
                <input
                  id="name"
                  name="name"
                  autoComplete="name"
                  required
                  disabled={waiting}
                  maxLength={80}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  aria-invalid={!!fields.name}
                  aria-describedby={fields.name ? 'name-error' : undefined}
                />
                {fields.name && (
                  <p className="field-error" id="name-error" role="alert">
                    {fields.name}
                  </p>
                )}
              </>
            )}
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              name="email"
              autoComplete="email"
              required
              disabled={waiting}
              maxLength={254}
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              aria-invalid={!!fields.email}
              aria-describedby={fields.email ? 'email-error' : undefined}
            />
            {fields.email && (
              <p className="field-error" id="email-error" role="alert">
                {fields.email}
              </p>
            )}
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              name="password"
              required
              disabled={waiting}
              minLength={register ? 8 : undefined}
              autoComplete={register ? 'new-password' : 'current-password'}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              aria-invalid={!!fields.password}
              aria-describedby={fields.password ? 'password-error' : undefined}
            />
            {register && <p className="input-hint">At least 8 characters, up to 72 UTF-8 bytes.</p>}
            {fields.password && (
              <p className="field-error" id="password-error" role="alert">
                {fields.password}
              </p>
            )}
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            <button className="primary full" disabled={waiting}>
              {pendingUser
                ? 'Opening your journal…'
                : busy
                  ? 'Please wait…'
                  : register
                    ? 'Create account'
                    : 'Log in'}
            </button>
          </form>
          <p className="auth-switch">
            {register ? 'Already have an account?' : 'New to Sweety?'}{' '}
            <button
              className="text-button"
              disabled={waiting}
              onClick={() => {
                setRegister(!register);
                setError('');
                setFields({});
                setSuccess('');
              }}
            >
              {register ? 'Log in' : 'Create an account'}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}
