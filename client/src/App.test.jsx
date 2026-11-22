import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from './App.jsx';
import { api } from './api.js';
import { SESSION_CHANGE_KEY } from './session.js';
import { ACCOUNT_HEADER } from '../../shared/auth.js';

vi.mock('./api.js', () => ({ api: vi.fn() }));
afterEach(() => vi.useRealTimers());
const A = { id: 'user-a', name: 'Reviewer A', email: 'usera@example.com' };
const B = { id: 'user-b', name: 'Reviewer B', email: 'userb@example.com' };
const today = '2026-10-15';
let currentUser, failReports, pendingReports, failSave, failHistory;
const oldEditLabel = 'Edit Morning (fasting) on 15 Oct 2026';
function report(path, value = currentUser?.id === 'user-b' ? 600 : 231) {
  const url = new URL(path, 'http://localhost');
  const date = url.searchParams.get('date') || today;
  const kind = url.searchParams.get('kind') || 'daily';
  return {
    kind,
    start: kind === 'daily' ? date : date.slice(0, 7) + '-01',
    end: date,
    stats: { count: 1, lowest: value, highest: value, average: value },
    readings: [{ id: `${currentUser?.id}-${date}`, date, slot: 'morning', value }],
  };
}

function delaySave(method) {
  const handler = api.getMockImplementation();
  let resolve, reject;
  const pending = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  const save = vi.fn(() => pending);
  api.mockImplementation((path, options) =>
    path.startsWith('/readings') && options?.method === method
      ? save(path, options)
      : handler(path, options),
  );
  return { save, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  currentUser = A;
  failReports = false;
  pendingReports = null;
  failSave = false;
  failHistory = false;
  api.mockImplementation(async (path, options = {}) => {
    if (path === '/config') return { today, timeZone: 'Asia/Kolkata' };
    if (path === '/auth/me') {
      if (!currentUser) throw Object.assign(new Error('Please log in.'), { status: 401 });
      return { user: currentUser };
    }
    if (path === '/auth/login') {
      currentUser = options.body.email === A.email ? A : B;
      return { user: currentUser };
    }
    if (
      (path.startsWith('/reports') || path.startsWith('/readings') || path === '/auth/logout') &&
      options.headers?.[ACCOUNT_HEADER] !== currentUser?.id
    )
      throw Object.assign(new Error('Your active account has changed.'), { status: 401 });
    if (path === '/auth/logout') {
      currentUser = null;
      return null;
    }
    if (path === '/readings' && options.method === 'POST') {
      if (failSave)
        throw Object.assign(new Error('Duplicate slot. Please choose another slot.'), {
          status: 409,
          fields: { slot: 'Duplicate slot.' },
        });
      return { reading: { ...options.body, id: 'created' } };
    }
    if (path.startsWith('/readings?')) {
      if (failHistory)
        throw Object.assign(new Error('History unavailable. Please try again.'), { status: 503 });
      return { readings: report('/reports').readings, total: 1, page: 1, limit: 12 };
    }
    if (path.startsWith('/reports?')) {
      if (failReports)
        throw Object.assign(new Error('Report unavailable. Please try again.'), { status: 500 });
      if (pendingReports) return pendingReports(path, options);
      return report(path);
    }
    throw new Error(`Unhandled review request ${path}`);
  });
});

test('a failed date change must not expose the previous date as the active daily readings', async () => {
  render(<App />);
  await screen.findByRole('button', { name: oldEditLabel });
  failReports = true;
  fireEvent.change(screen.getByLabelText('Selected date'), { target: { value: '2026-10-14' } });
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: oldEditLabel })).not.toBeInTheDocument();
});

test('an initial report failure must not claim that the date has no saved readings', async () => {
  failReports = true;
  render(<App />);
  await screen.findByRole('alert');
  const empty = screen.queryByText('A fresh page. Add your first reading for this date.');
  expect(empty).not.toBeInTheDocument();
});

test('a reading draft entered while reports load must survive their completion', async () => {
  let resolve;
  const gate = new Promise((done) => {
    resolve = done;
  });
  pendingReports = async (path) => {
    await gate;
    return report(path);
  };
  render(<App />);
  await screen.findByLabelText('Glucose value');
  fireEvent.change(screen.getByLabelText('Glucose value'), { target: { value: '145' } });
  expect(screen.getByLabelText('Glucose value')).toHaveValue('145');
  const slotBefore = screen.getByLabelText('Time slot').value;
  await act(async () => {
    resolve();
    await gate;
  });
  await screen.findByRole('button', { name: oldEditLabel });
  expect(screen.getByLabelText('Glucose value')).toHaveValue('145');
  expect(screen.getByLabelText('Time slot')).toHaveValue(slotBefore);
});

test('rejected save retains user input and creates no success notice', async () => {
  failSave = true;
  render(<App />);
  await screen.findByRole('button', { name: oldEditLabel });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Glucose value'), '145');
  await user.click(screen.getByRole('button', { name: 'Save reading' }));
  await screen.findByText('Duplicate slot. Please choose another slot.');
  expect(screen.getByLabelText('Glucose value')).toHaveValue('145');
  expect(screen.queryByText(/Reading saved/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Time slot')).toHaveAttribute('aria-invalid', 'true');
});

test('a pending create prevents editing the submitted draft until the request succeeds', async () => {
  const pending = delaySave('POST');
  render(<App />);
  await screen.findByRole('button', { name: oldEditLabel });
  const user = userEvent.setup();
  const value = screen.getByLabelText('Glucose value');
  await user.selectOptions(screen.getByLabelText('Time slot'), 'after_lunch');
  await user.type(value, '120');
  await user.click(screen.getByRole('button', { name: 'Save reading' }));

  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(screen.getByLabelText('Date', { exact: true })).toBeDisabled();
  expect(screen.getByLabelText('Time slot')).toBeDisabled();
  expect(value).toBeDisabled();
  await user.type(value, '180');
  expect(value).toHaveValue('120');
  expect(pending.save).toHaveBeenCalledExactlyOnceWith('/readings', {
    method: 'POST',
    body: { date: today, slot: 'after_lunch', value: 120 },
    headers: { [ACCOUNT_HEADER]: A.id },
  });

  await act(async () => {
    pending.resolve({ reading: { id: 'created', date: today, slot: 'after_lunch', value: 120 } });
  });
  expect(screen.getByText(/Reading saved/)).toBeVisible();
  expect(screen.getByLabelText('Glucose value')).toBeEnabled();
  expect(screen.getByLabelText('Glucose value')).toHaveValue('');
});

test('an outstanding edit blocks cancel and replacement and keeps its value when the save fails', async () => {
  const pending = delaySave('PUT');
  render(<App />);
  const edit = await screen.findByRole('button', { name: oldEditLabel });
  const user = userEvent.setup();
  await user.click(edit);
  const value = screen.getByLabelText('Glucose value');
  await user.clear(value);
  await user.type(value, '120');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));

  const cancel = screen.getByRole('button', { name: 'Cancel', exact: true });
  const add = screen.getByRole('button', { name: 'Add After lunch' });
  expect(cancel).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel edit' })).toBeDisabled();
  expect(edit).toBeDisabled();
  expect(add).toBeDisabled();
  expect(screen.getByLabelText('Selected date')).toBeDisabled();
  await user.click(cancel);
  await user.click(add);
  expect(screen.getByRole('heading', { name: 'Edit reading' })).toBeVisible();
  expect(screen.getByLabelText('Glucose value')).toHaveValue('120');

  await act(async () => {
    pending.reject(new Error('Save unavailable. Please try again.'));
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Save unavailable. Please try again.');
  expect(value).toBeEnabled();
  expect(value).toHaveValue('120');
  expect(cancel).toBeEnabled();
  expect(add).toBeEnabled();
  expect(screen.queryByText('Reading updated.')).not.toBeInTheDocument();
  await user.click(cancel);
  await user.click(add);
  await user.type(screen.getByLabelText('Glucose value'), '180');
  expect(screen.getByLabelText('Glucose value')).toHaveValue('180');
});

test('login success stays on the login screen for 1.5 seconds; account switching clears private readings', async () => {
  currentUser = null;
  render(<App />);
  const user = userEvent.setup();
  async function login(account) {
    await screen.findByLabelText('Email address');
    await user.type(screen.getByLabelText('Email address'), account.email);
    await user.type(screen.getByLabelText('Password'), 'ReviewPassword123!');
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Log in', exact: true }).closest('form'));
    });
    expect(screen.getByText('Login successful!')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Good to see you.' })).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Your day, at a glance.' }),
    ).not.toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1499);
    });
    expect(screen.getByText('Login successful!')).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'Your day, at a glance.' }),
    ).not.toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    vi.useRealTimers();
    await screen.findByRole('button', { name: oldEditLabel });
    expect(screen.queryByText('Login successful!')).not.toBeInTheDocument();
  }
  await login(A);
  expect(document.querySelector('.reading-number strong').textContent).toBe('231');
  vi.useFakeTimers();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
  });
  expect(screen.getByRole('heading', { name: 'Good to see you.' })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Logout successful!');
  expect(document.querySelector('.reading-number')).toBeNull();
  expect(screen.queryByText('Login successful!')).not.toBeInTheDocument();
  await act(async () => {
    vi.advanceTimersByTime(2999);
  });
  expect(screen.getByRole('status')).toHaveTextContent('Logout successful!');
  await act(async () => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.queryByText('Logout successful!')).not.toBeInTheDocument();
  vi.useRealTimers();
  await login(B);
  expect(document.querySelector('.reading-number strong').textContent).toBe('600');
});

test('another tab signing in clears the old account and its draft before showing the new report', async () => {
  const { container } = render(<App />);
  await screen.findByRole('button', { name: oldEditLabel });
  fireEvent.change(screen.getByLabelText('Glucose value'), { target: { value: '145' } });
  expect(screen.getByText('Reviewer A')).toBeVisible();
  expect(container.querySelector('.reading-number strong')).toHaveTextContent('231');

  let finishCheck;
  const handler = api.getMockImplementation();
  api.mockImplementation((path, options) =>
    path === '/auth/me'
      ? new Promise((resolve) => {
          finishCheck = resolve;
        })
      : handler(path, options),
  );
  currentUser = B;
  await act(async () => {
    window.dispatchEvent(
      new StorageEvent('storage', { key: SESSION_CHANGE_KEY, newValue: 'new-session' }),
    );
  });
  expect(screen.queryByText('Reviewer A')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Glucose value')).not.toBeInTheDocument();
  expect(container.querySelector('.reading-number')).toBeNull();

  await act(async () => {
    finishCheck({ user: B });
  });
  await screen.findByRole('button', { name: oldEditLabel });
  expect(screen.getByText('Reviewer B')).toBeVisible();
  expect(container.querySelector('.reading-number strong')).toHaveTextContent('600');
  expect(screen.getByLabelText('Glucose value')).toHaveValue('');
  expect(api).toHaveBeenCalledWith(
    `/reports?kind=daily&date=${today}`,
    expect.objectContaining({ headers: { [ACCOUNT_HEADER]: B.id } }),
  );
});

test('refocusing a tab rechecks the session and preserves the draft when the account matches', async () => {
  render(<App />);
  await screen.findByRole('button', { name: oldEditLabel });
  fireEvent.change(screen.getByLabelText('Glucose value'), { target: { value: '145' } });
  const checks = () => api.mock.calls.filter(([path]) => path === '/auth/me').length;
  const previousChecks = checks();
  await act(async () => {
    fireEvent.focus(window);
  });
  expect(checks()).toBe(previousChecks + 1);
  expect(screen.getByText('Reviewer A')).toBeVisible();
  expect(screen.getByLabelText('Glucose value')).toHaveValue('145');

  currentUser = B;
  await act(async () => {
    fireEvent.focus(window);
  });
  expect(await screen.findByText('Reviewer B')).toBeVisible();
  expect(screen.queryByText('Reviewer A')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Glucose value')).toHaveValue('');
});

test('retries a failed delete only after reopening and confirming the deletion', async () => {
  const handler = api.getMockImplementation();
  let deleted = false;
  const remove = vi
    .fn()
    .mockRejectedValueOnce(new Error('Delete failed.'))
    .mockImplementation(async () => {
      deleted = true;
      return null;
    });
  api.mockImplementation((path, options) => {
    if (options?.method === 'DELETE') return remove(path, options);
    if (deleted && path.startsWith('/reports?'))
      return Promise.resolve({
        ...report(path),
        readings: [],
        stats: { count: 0, highest: null, lowest: null, average: null },
      });
    return handler(path, options);
  });
  render(<App />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Delete Morning (fasting) on 15 Oct 2026' }),
  );
  await user.click(screen.getByRole('button', { name: 'Delete reading', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Delete failed.');
  expect(screen.getByRole('button', { name: oldEditLabel })).toBeVisible();
  expect(screen.queryByText('Reading deleted.')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Retry delete' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(remove).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Delete reading', exact: true }));
  expect(await screen.findByText('Reading deleted.')).toBeVisible();
  expect(remove).toHaveBeenCalledTimes(2);
  expect(
    await screen.findByText('A fresh page. Add your first reading for this date.'),
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: oldEditLabel })).not.toBeInTheDocument();
});

test('an aborted old date request does not replace the latest selected date', async () => {
  render(<App />);
  await screen.findByRole('button', { name: oldEditLabel });
  const pending = [];
  pendingReports = (path, { signal }) => {
    if (!path.includes('2026-10-14')) return Promise.resolve(report(path, 89));
    return new Promise((resolve, reject) => {
      pending.push({ signal, resolve: () => resolve(report(path, 599)) });
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
        once: true,
      });
    });
  };
  fireEvent.change(screen.getByLabelText('Selected date'), { target: { value: '2026-10-14' } });
  await waitFor(() => expect(pending.length).toBe(2));
  fireEvent.change(screen.getByLabelText('Selected date'), { target: { value: '2026-10-13' } });
  await screen.findByRole('button', { name: 'Edit Morning (fasting) on 13 Oct 2026' });
  await act(async () => {
    pending.forEach((item) => item.resolve());
  });
  expect(pending.every((item) => item.signal.aborted)).toBe(true);
  expect(document.querySelector('.reading-number strong').textContent).toBe('89');
  expect(screen.getByLabelText('Selected date')).toHaveValue('2026-10-13');
});

test('history stays usable when reports fail and reloading reports preserves the draft', async () => {
  failReports = true;
  render(<App />);
  await screen.findByRole('alert');
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Glucose value'), '145');
  await user.click(screen.getByRole('button', { name: 'Reading history' }));
  await screen.findByRole('table');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Overview' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Report unavailable.');
  failReports = false;
  await user.click(screen.getByRole('button', { name: 'Reload reports' }));
  await screen.findByRole('button', { name: oldEditLabel });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Glucose value')).toHaveValue('145');
  expect(screen.getByLabelText('Time slot')).toHaveValue('morning');
});

test('a history failure leaves the daily count, average and slots visible on overview', async () => {
  failHistory = true;
  render(<App />);
  await screen.findByRole('button', { name: oldEditLabel });
  expect(screen.getByText('231.0')).toBeVisible();
  expect(screen.getByText('1 of 4 recorded')).toBeVisible();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Reading history' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('History unavailable.');
  expect(screen.getByText('Unable to load history. Please try again.')).toBeVisible();
  expect(screen.queryByText('Your journal is ready.')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Overview' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('231.0')).toBeVisible();
  expect(screen.getByText('1 of 4 recorded')).toBeVisible();
  expect(screen.getByRole('button', { name: oldEditLabel })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Reading history' }));
  await screen.findByRole('alert');
  failHistory = false;
  await user.click(screen.getByRole('button', { name: 'Reload history' }));
  await screen.findByRole('table');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a successful zero-row response still shows genuine empty reports and history', async () => {
  const handler = api.getMockImplementation();
  api.mockImplementation((path, options) => {
    if (path.startsWith('/reports?'))
      return Promise.resolve({
        ...report(path),
        stats: { count: 0, lowest: null, highest: null, average: null },
        readings: [],
      });
    if (path.startsWith('/readings?'))
      return Promise.resolve({ readings: [], total: 0, page: 1, limit: 12 });
    return handler(path, options);
  });
  render(<App />);
  expect(
    await screen.findByText('A fresh page. Add your first reading for this date.'),
  ).toBeVisible();
  expect(screen.getAllByText('Not recorded yet')).toHaveLength(4);
  expect(screen.getByText('Your next reading starts the picture.')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reading history' }));
  expect(screen.getByText('Your journal is ready.')).toBeVisible();
});

test('a pristine form follows the next free slot and a successful save resets its draft', async () => {
  const handler = api.getMockImplementation();
  let saved;
  api.mockImplementation(async (path, options) => {
    if (path === '/readings' && options?.method === 'POST') {
      saved = { ...options.body, id: 'created-reading' };
      return { reading: saved };
    }
    if (saved && path.startsWith('/reports?')) {
      const original = report(path);
      return {
        ...original,
        readings: [...original.readings, saved],
        stats: { count: 2, lowest: 145, highest: 231, average: 188 },
      };
    }
    return handler(path, options);
  });
  render(<App />);
  await screen.findByRole('button', { name: oldEditLabel });
  await waitFor(() => expect(screen.getByLabelText('Time slot')).toHaveValue('after_breakfast'));
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Glucose value'), '145');
  await user.click(screen.getByRole('button', { name: 'Save reading' }));
  await screen.findByText('2 of 4 recorded');
  expect(screen.getByText('Reading saved. A little check-in, complete.')).toBeVisible();
  expect(screen.getByLabelText('Glucose value')).toHaveValue('');
  await waitFor(() => expect(screen.getByLabelText('Time slot')).toHaveValue('after_lunch'));
  expect(saved).toMatchObject({ date: today, slot: 'after_breakfast', value: 145 });
});

test('an edit rejected because the reading was deleted keeps the draft and never reports success', async () => {
  const handler = api.getMockImplementation();
  api.mockImplementation((path, options) => {
    if (options?.method === 'PUT')
      return Promise.reject(Object.assign(new Error('Reading not found.'), { status: 404 }));
    return handler(path, options);
  });
  render(<App />);
  await screen.findByRole('button', { name: oldEditLabel });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: oldEditLabel }));
  await user.clear(screen.getByLabelText('Glucose value'));
  await user.type(screen.getByLabelText('Glucose value'), '145');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Reading not found.');
  expect(screen.getByLabelText('Glucose value')).toHaveValue('145');
  expect(screen.queryByText('Reading updated.')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  expect(screen.getByLabelText('Glucose value')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Save reading' })).toBeVisible();
});
