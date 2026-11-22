import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Droplet,
  LayoutDashboard,
  LogOut,
  Moon,
  Pencil,
  Plus,
  ShieldCheck,
  Sun,
  Sunrise,
  Sunset,
  Trash2,
} from 'lucide-react';
import { api } from './api.js';
import { announceSessionChange, SESSION_CHANGE_KEY } from './session.js';
import Auth from './components/Auth.jsx';
import ReadingForm from './components/ReadingForm.jsx';
import SuccessToast, { SUCCESS_TOAST_MS } from './components/SuccessToast.jsx';
import TrendChart from './components/TrendChart.jsx';
import { ACCOUNT_HEADER } from '../../shared/auth.js';
import { displayDate, SLOTS } from '../../shared/domain.js';

const slotIcons = [Sunrise, Sun, Sunset, Moon];
const reportKinds = [
  ['daily', 'Daily'],
  ['month-to-date', 'Month to date'],
  ['monthly', 'Previous month'],
];

function OpeningJournal() {
  return (
    <div className="boot-state" role="status">
      <Droplet size={36} />
      <p>Opening your journal…</p>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [logoutNotice, setLogoutNotice] = useState('');
  const [config, setConfig] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState('');
  const sessionRequest = useRef(null);

  const checkSession = useCallback(async (resetAccount = false) => {
    sessionRequest.current?.abort();
    const controller = new AbortController();
    sessionRequest.current = controller;
    setCheckingSession(true);
    setError('');
    if (resetAccount) {
      setUser(null);
      setLogoutNotice('');
    }
    try {
      const { signal } = controller;
      const [config, result] = await Promise.all([
        api('/config', { signal }),
        api('/auth/me', { signal }).catch((error) => {
          if (error.status === 401) return { user: null };
          throw error;
        }),
      ]);
      if (!signal.aborted) {
        setConfig(config);
        setUser(result.user);
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(error.message);
    } finally {
      if (sessionRequest.current === controller) {
        sessionRequest.current = null;
        if (!controller.signal.aborted) setCheckingSession(false);
      }
    }
  }, []);
  const invalidateSession = useCallback(() => checkSession(true), [checkSession]);

  useEffect(() => {
    checkSession();
    return () => sessionRequest.current?.abort();
  }, [checkSession]);
  useEffect(() => {
    const recheckOnFocus = () => {
      if (user && document.visibilityState !== 'hidden' && !sessionRequest.current) checkSession();
    };
    const onStorage = (event) => {
      if (event.key === SESSION_CHANGE_KEY) invalidateSession();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', recheckOnFocus);
    document.addEventListener('visibilitychange', recheckOnFocus);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', recheckOnFocus);
      document.removeEventListener('visibilitychange', recheckOnFocus);
    };
  }, [checkSession, invalidateSession, user]);
  const handleLogin = useCallback((account) => {
    sessionRequest.current?.abort();
    setCheckingSession(false);
    setLogoutNotice('');
    setUser(account);
  }, []);
  const handleLogout = useCallback(() => {
    announceSessionChange();
    sessionRequest.current?.abort();
    setCheckingSession(false);
    setLogoutNotice('Logout successful!');
    setUser(null);
  }, []);

  if (error)
    return (
      <div className="boot-state">
        <p role="alert">{error}</p>
        <button className="primary" onClick={() => checkSession(true)}>
          Try again
        </button>
      </div>
    );
  if (!user || !config)
    return checkingSession ? (
      <OpeningJournal />
    ) : (
      <Auth onLogin={handleLogin} initialSuccess={logoutNotice} />
    );
  return (
    <>
      {checkingSession && <OpeningJournal />}
      <div hidden={checkingSession}>
        <Dashboard
          key={user.id}
          user={user}
          config={config}
          checkingSession={checkingSession}
          onLogout={handleLogout}
          onSessionInvalid={invalidateSession}
        />
      </div>
    </>
  );
}

function Dashboard({ user, config, checkingSession, onLogout, onSessionInvalid }) {
  const [view, setView] = useState('overview');
  const [date, setDate] = useState(config.today);
  const [kind, setKind] = useState('daily');
  const [reports, setReports] = useState(null);
  const [historyResult, setHistoryResult] = useState(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [reportRetry, setReportRetry] = useState(0);
  const [historyRetry, setHistoryRetry] = useState(0);
  const [formReset, setFormReset] = useState(0);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busyDelete, setBusyDelete] = useState(false);
  const [operationError, setOperationError] = useState(null);
  const [notice, setNotice] = useState(null);
  const formRef = useRef(null);
  const dialogRef = useRef(null);
  const mounted = useRef(false);
  const requestKey = `${date}-${kind}-${revision}-${reportRetry}`;
  const historyKey = `${page}-${revision}-${historyRetry}`;
  const current = reports?.key === requestKey ? reports : null;
  const loading = !current || current.status === 'loading';
  const available = current?.status === 'success';
  const { report, daily, trend } = available ? current : {};
  const currentHistory = historyResult?.key === historyKey ? historyResult : null;
  const historyLoading = !currentHistory || currentHistory.status === 'loading';
  const history = currentHistory?.data;
  const loadError = view === 'overview' ? current?.error : currentHistory?.error;

  const accountApi = useCallback(
    (path, options) => api(path, { ...options, headers: { [ACCOUNT_HEADER]: user.id } }),
    [user.id],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setReports({ key: requestKey, status: 'loading' });
    const query = (reportKind) =>
      accountApi(`/reports?kind=${reportKind}&date=${date}`, { signal: controller.signal });
    const dailyPromise = query('daily');
    const trendPromise = query('month-to-date');
    Promise.all([
      kind === 'daily' ? dailyPromise : kind === 'month-to-date' ? trendPromise : query(kind),
      dailyPromise,
      trendPromise,
    ])
      .then(([report, daily, trend]) => {
        if (controller.signal.aborted) return;
        setReports({ key: requestKey, status: 'success', report, daily, trend });
      })
      .catch((error) => {
        if (!controller.signal.aborted && error.name !== 'AbortError') {
          if (error.status === 401) onSessionInvalid();
          else setReports({ key: requestKey, status: 'error', error: error.message });
        }
      });
    return () => controller.abort();
  }, [accountApi, date, kind, onSessionInvalid, requestKey]);
  useEffect(() => {
    if (view !== 'history') return;
    const controller = new AbortController();
    setHistoryResult({ key: historyKey, status: 'loading' });
    accountApi(`/readings?page=${page}&limit=12`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, Math.ceil(data.total / 12));
        if (page > lastPage) setPage(lastPage);
        else setHistoryResult({ key: historyKey, status: 'success', data });
      })
      .catch((error) => {
        if (controller.signal.aborted || error.name === 'AbortError') return;
        if (error.status === 401) onSessionInvalid();
        else setHistoryResult({ key: historyKey, status: 'error', error: error.message });
      });
    return () => controller.abort();
  }, [accountApi, historyKey, onSessionInvalid, page, view]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), SUCCESS_TOAST_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (deleting && !checkingSession) dialogRef.current?.showModal();
  }, [checkingSession, deleting]);

  async function saveReading(body, id) {
    setSaving(true);
    try {
      await accountApi(id ? `/readings/${id}` : '/readings', { method: id ? 'PUT' : 'POST', body });
      setEditing(null);
      setFormReset((reset) => reset + 1);
      setDate(body.date);
      setRevision((r) => r + 1);
      setNotice({
        message: id ? 'Reading updated.' : 'Reading saved. A little check-in, complete.',
      });
    } catch (error) {
      if (error.status === 401 && mounted.current) onSessionInvalid();
      throw error;
    } finally {
      setSaving(false);
    }
  }
  function openReadingForm(reading) {
    setEditing(reading);
    formRef.current?.scrollIntoView({ block: 'center' });
  }
  function confirmDelete(reading) {
    setOperationError(null);
    setDeleting(reading);
  }
  async function remove() {
    setBusyDelete(true);
    try {
      await accountApi(`/readings/${deleting.id}`, { method: 'DELETE' });
      if (editing?.id === deleting.id) setEditing(null);
      setDeleting(null);
      setRevision((r) => r + 1);
      setNotice({ message: 'Reading deleted.' });
    } catch (error) {
      if (error.status === 401) {
        if (mounted.current) onSessionInvalid();
      } else {
        setDeleting(null);
        setOperationError({ message: error.message, reading: deleting });
      }
    } finally {
      setBusyDelete(false);
    }
  }
  async function logout() {
    setOperationError(null);
    try {
      await accountApi('/auth/logout', { method: 'POST' });
      if (mounted.current) onLogout();
      else announceSessionChange();
    } catch (error) {
      if (!mounted.current) return;
      if (error.status === 401) onSessionInvalid();
      else setOperationError({ message: error.message });
    }
  }
  function actions(reading) {
    const label = `${SLOTS.find((slot) => slot.value === reading.slot)?.label} on ${displayDate(reading.date)}`;
    return (
      <div className="row-actions">
        <button
          className="icon-button"
          title="Edit reading"
          aria-label={`Edit ${label}`}
          disabled={saving}
          onClick={() => openReadingForm(reading)}
        >
          <Pencil size={16} />
        </button>
        <button
          className="icon-button danger"
          title="Delete reading"
          aria-label={`Delete ${label}`}
          disabled={saving}
          onClick={() => confirmDelete(reading)}
        >
          <Trash2 size={16} />
        </button>
      </div>
    );
  }
  const count = daily?.stats.count;
  const nextSlot =
    SLOTS.find((slot) => !daily?.readings.some((r) => r.slot === slot.value))?.value || 'morning';
  return (
    <div className="app-layout">
      <SuccessToast message={notice?.message} />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Droplet size={24} />
          </span>
          sweety<span className="brand-period">.</span>
        </a>
        <span className="sidebar-caption">YOUR PERSONAL JOURNAL</span>
        <nav aria-label="Main navigation">
          <button
            className={view === 'overview' ? 'active' : ''}
            onClick={() => setView('overview')}
            aria-current={view === 'overview' ? 'page' : undefined}
          >
            <LayoutDashboard size={20} />
            Overview
          </button>
          <button
            className={view === 'history' ? 'active' : ''}
            onClick={() => setView('history')}
            aria-current={view === 'history' ? 'page' : undefined}
          >
            <BarChart3 size={20} />
            Reading history
          </button>
        </nav>
        <div className="sidebar-note">
          <div className="note-icon">
            <ShieldCheck size={23} />
          </div>
          <strong>A space just for you.</strong>
          <p>Your readings are private and only visible in your account.</p>
        </div>
        <div className="account">
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user.name}</strong>
            <span>Personal account</span>
          </div>
          <button className="icon-button" onClick={logout} aria-label="Log out" title="Log out">
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <main className="main" id="main">
        <header className="topbar">
          <div className="topbar-copy" key={view}>
            <span className="eyebrow">YOUR GLUCOSE JOURNAL</span>
            <h1>
              {view === 'overview' ? 'Your day, at a glance.' : 'Every reading, in one place.'}
            </h1>
            <p className="muted">
              {view === 'overview'
                ? `Welcome back, ${user.name.split(' ')[0]}. Every check-in counts.`
                : 'Look back, make an edit, and keep your journal up to date.'}
            </p>
          </div>
          <div className="date-control">
            <label htmlFor="selected-date">Selected date</label>
            <input
              id="selected-date"
              type="date"
              min="1900-01-01"
              max={config.today}
              value={date}
              disabled={saving}
              onChange={(e) => {
                if (e.target.value && e.target.validity.valid) {
                  setDate(e.target.value);
                  setEditing(null);
                }
              }}
            />
            <span>{config.timeZone}</span>
          </div>
        </header>
        {operationError && (
          <div className="alert retry-alert" role="alert">
            {operationError.message}
            <button
              className="text-button"
              disabled={Boolean(operationError.reading) && saving}
              onClick={() =>
                operationError.reading ? confirmDelete(operationError.reading) : logout()
              }
            >
              {operationError.reading ? 'Retry delete' : 'Retry logout'}
            </button>
          </div>
        )}
        {loadError && (
          <div className="alert retry-alert" role="alert">
            {loadError}
            <button
              className="text-button"
              onClick={() =>
                view === 'overview' ? setReportRetry((n) => n + 1) : setHistoryRetry((n) => n + 1)
              }
            >
              {view === 'overview' ? 'Reload reports' : 'Reload history'}
            </button>
          </div>
        )}
        {view === 'overview' && (
          <>
            <section className="rhythm-card">
              <div className="rhythm-copy">
                <span className="eyebrow">MAKE ROOM FOR A LITTLE CARE</span>
                <h2>
                  Small steps.
                  <br />A clearer picture.
                </h2>
                <p>Your daily rhythm, one reading at a time.</p>
              </div>
              <div className="rhythm-progress">
                <div className="progress-title">
                  <strong>
                    {loading ? '…' : available ? count : '—'}
                    <span> / 4</span>
                  </strong>
                  <span>
                    readings recorded
                    <br />
                    {displayDate(date, { year: undefined })}
                  </span>
                </div>
                <div className="slot-progress">
                  {SLOTS.map((slot, index) => {
                    const Icon = slotIcons[index];
                    const complete = daily?.readings.some((r) => r.slot === slot.value);
                    return (
                      <div className={complete ? 'complete' : ''} key={slot.value}>
                        <span>
                          <Icon size={20} />
                          {complete && <Check className="slot-check" size={12} />}
                        </span>
                        <small>{slot.short}</small>
                      </div>
                    );
                  })}
                </div>
                {count === 4 && !loading && (
                  <p className="day-complete">
                    All four slots are recorded. You can add only 4 readings per day.
                  </p>
                )}
              </div>
            </section>
            <section className="reports" aria-label="Glucose report">
              <div className="section-heading">
                <h2>Your numbers</h2>
                <div className="segmented" aria-label="Report period">
                  {reportKinds.map(([value, label]) => (
                    <button
                      key={value}
                      className={kind === value ? 'selected' : ''}
                      aria-pressed={kind === value}
                      onClick={() => setKind(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="report-range">
                {loading
                  ? 'Loading report…'
                  : available
                    ? `${displayDate(report.start)}${report.start !== report.end ? ` – ${displayDate(report.end)}` : ''}`
                    : 'Report unavailable'}
              </p>
              <div className="stats-grid" aria-busy={loading}>
                {[
                  ['Average', 'average', 'A little perspective'],
                  ['Highest', 'highest', 'Highest in this period'],
                  ['Lowest', 'lowest', 'Lowest in this period'],
                  ['Readings', 'count', 'Every check-in counts'],
                ].map(([title, key, caption]) => (
                  <article className={`stat-card ${key === 'average' ? 'featured' : ''}`} key={key}>
                    <span>
                      {title}
                      {key === 'average' && <Activity size={18} />}
                    </span>
                    <strong>
                      {loading
                        ? '…'
                        : report?.stats[key] == null
                          ? '—'
                          : key === 'average'
                            ? report.stats[key].toFixed(1)
                            : report.stats[key]}
                      {key !== 'count' && <small>mg/dl</small>}
                    </strong>
                    <p>{caption}</p>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
        <div className="content-grid">
          <div className="content-left">
            {view === 'overview' ? (
              <section className="panel readings-panel">
                <div className="panel-title">
                  <h2>{kind === 'daily' ? 'The daily check-in' : 'Readings over time'}</h2>
                  <span className="pill">
                    {loading
                      ? 'Loading…'
                      : !available
                        ? 'Unavailable'
                        : kind === 'daily'
                          ? `${count} of 4 recorded`
                          : `${report.stats.count} readings`}
                  </span>
                </div>
                <p className="muted">
                  {kind === 'daily'
                    ? 'Four moments to build your daily picture.'
                    : 'Your saved readings across the selected report period.'}
                </p>
                {loading ? (
                  <div className="empty" role="status">
                    Loading your readings…
                  </div>
                ) : !available ? (
                  <div className="empty">Unable to load readings. Please try again.</div>
                ) : kind === 'daily' ? (
                  <>
                    {count === 0 && (
                      <p className="empty-inline">
                        A fresh page. Add your first reading for this date.
                      </p>
                    )}
                    <div className="reading-list">
                      {SLOTS.map((slot, index) => {
                        const reading = daily?.readings.find((r) => r.slot === slot.value);
                        const Icon = slotIcons[index];
                        return (
                          <div className="reading-row" key={slot.value}>
                            <span className={`slot-icon ${reading ? 'recorded' : ''}`}>
                              <Icon size={22} />
                            </span>
                            <div className="reading-label">
                              <strong>{slot.label}</strong>
                              <span>{reading ? 'Recorded' : 'Not recorded yet'}</span>
                            </div>
                            <div className="reading-number">
                              {reading ? (
                                <>
                                  <strong>{reading.value}</strong>
                                  <span>mg/dl</span>
                                </>
                              ) : (
                                <span className="dash">—</span>
                              )}
                            </div>
                            {reading ? (
                              actions(reading)
                            ) : (
                              <button
                                className="icon-button add-slot"
                                aria-label={`Add ${slot.label}`}
                                disabled={saving}
                                onClick={() =>
                                  openReadingForm({ date, slot: slot.value, value: '' })
                                }
                              >
                                <Plus size={18} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <TrendChart readings={report?.readings || []} />
                )}
              </section>
            ) : (
              <section className="panel history-panel">
                <div className="panel-title">
                  <h2>Reading history</h2>
                  <span className="pill">
                    {historyLoading
                      ? 'Loading…'
                      : history
                        ? `${history.total} readings`
                        : 'Unavailable'}
                  </span>
                </div>
                <p className="muted">All dates · Most recent first</p>
                {historyLoading ? (
                  <div className="empty" role="status">
                    Loading your readings…
                  </div>
                ) : !history ? (
                  <div className="empty">Unable to load history. Please try again.</div>
                ) : !history.readings.length ? (
                  <div className="empty">
                    <Droplet size={30} />
                    <p>Your journal is ready.</p>
                    <span>Add a reading to get started.</span>
                  </div>
                ) : (
                  <>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Time slot</th>
                            <th>mg/dl</th>
                            <th>
                              <span className="sr-only">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.readings.map((reading) => (
                            <tr key={reading.id}>
                              <td>{displayDate(reading.date)}</td>
                              <td>{SLOTS.find((slot) => slot.value === reading.slot)?.label}</td>
                              <td className="table-value">{reading.value}</td>
                              <td>{actions(reading)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="pagination">
                      <span>
                        Page {page} of {Math.max(1, Math.ceil(history.total / 12))}
                      </span>
                      <div>
                        <button
                          className="icon-button"
                          disabled={page <= 1}
                          onClick={() => setPage(page - 1)}
                          aria-label="Previous page"
                        >
                          <ChevronLeft size={20} />
                        </button>
                        <button
                          className="icon-button"
                          disabled={page * 12 >= history.total}
                          onClick={() => setPage(page + 1)}
                          aria-label="Next page"
                        >
                          <ChevronRight size={20} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </section>
            )}
            {view === 'overview' && kind === 'daily' && (
              <section className="panel trend-panel">
                <div className="panel-title">
                  <h2>Your month in view</h2>
                  <span className="legend">
                    <span />
                    Glucose
                  </span>
                </div>
                <p className="muted">
                  {trend
                    ? `${displayDate(trend.start)} – ${displayDate(trend.end)}`
                    : 'Month to date'}
                </p>
                {loading ? (
                  <div className="empty">Loading your trend…</div>
                ) : !available ? (
                  <div className="empty">Unable to load your trend. Please try again.</div>
                ) : (
                  <TrendChart readings={trend?.readings || []} />
                )}
              </section>
            )}
          </div>
          <div ref={formRef}>
            <ReadingForm
              key={`${editing?.id || editing?.slot || 'new'}-${date}-${formReset}`}
              initialSlot={nextSlot}
              today={config.today}
              selectedDate={date}
              reading={editing}
              saving={saving}
              onSave={saveReading}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
        <footer className="main-footer">
          <span>
            <Droplet size={15} /> A little care, every day.
          </span>
          <span>A personal journal for recording and reviewing your readings.</span>
        </footer>
      </main>
      {deleting && !checkingSession && (
        <dialog
          ref={dialogRef}
          className="delete-dialog"
          onCancel={(e) => {
            if (busyDelete) e.preventDefault();
            else setDeleting(null);
          }}
        >
          <h2>Delete this reading?</h2>
          <p>
            {SLOTS.find((s) => s.value === deleting.slot)?.label} · {displayDate(deleting.date)} ·{' '}
            {deleting.value} mg/dl
          </p>
          <p className="muted">This reading will be removed from your reports.</p>
          <div className="dialog-actions">
            <button
              className="secondary"
              autoFocus
              disabled={busyDelete}
              onClick={() => setDeleting(null)}
            >
              Keep reading
            </button>
            <button className="danger-button" disabled={busyDelete} onClick={remove}>
              {busyDelete ? 'Deleting…' : 'Delete reading'}
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
