import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from './App.jsx';
import { api } from './api.js';

vi.mock('./api.js', () => ({ api: vi.fn() }));
afterEach(() => vi.useRealTimers());
const A = { id: 'user-a', name: 'Reviewer A', email: 'usera@example.com' };
const B = { id: 'user-b', name: 'Reviewer B', email: 'userb@example.com' };
const today = '2026-10-15';
let currentUser, failReports, pendingReports, failSave;
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
  currentUser = A;
  failReports = false;
  pendingReports = null;
  failSave = false;
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
    if (path.startsWith('/readings?'))
      return { readings: report('/reports').readings, total: 1, page: 1, limit: 12 };
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

test('retry recovers history and reports without erasing an unsaved draft', async () => {
  failReports = true;
  render(<App />);
  await screen.findByRole('alert');
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Glucose value'), '145');
  await user.click(screen.getByRole('button', { name: 'Reading history' }));
  expect(screen.getByText('Unable to load history. Please try again.')).toBeVisible();
  expect(screen.queryByText('Your journal is ready.')).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  failReports = false;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('table');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Glucose value')).toHaveValue('145');
  expect(screen.getByLabelText('Time slot')).toHaveValue('morning');
  await user.click(screen.getByRole('button', { name: 'Overview' }));
  expect(screen.getByRole('button', { name: oldEditLabel })).toBeVisible();
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
