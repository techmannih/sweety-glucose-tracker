import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import Auth from './Auth.jsx';
import { api } from '../api.js';
import { SIGNUP_SUCCESS_MESSAGE } from '../../../shared/auth.js';

vi.mock('../api.js', () => ({ api: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());

async function fillSignup(email) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Create an account', exact: true }));
  await user.type(screen.getByLabelText('Your name'), 'Manish');
  await user.type(screen.getByLabelText('Email address'), email);
  await user.type(screen.getByLabelText('Password'), 'TestPassword123!');
  return user;
}

async function submitLogin() {
  await act(async () => {
    fireEvent.submit(screen.getByRole('button', { name: 'Log in', exact: true }).closest('form'));
  });
}

describe('Sign up and login', () => {
  test.each([
    'alex@example.com',
    'alex123@example.com',
    'alex.morgan@example.com',
    'alex_123@example.net',
    'developer@example.org',
  ])('accepts %s and shows signup success without opening the dashboard', async (email) => {
    const onLogin = vi.fn();
    api.mockResolvedValueOnce({ message: SIGNUP_SUCCESS_MESSAGE });
    render(<Auth onLogin={onLogin} />);
    const user = await fillSignup(email);
    await user.click(screen.getByRole('button', { name: 'Create account', exact: true }));
    expect(await screen.findByRole('status')).toHaveTextContent(SIGNUP_SUCCESS_MESSAGE);
    expect(api).toHaveBeenCalledExactlyOnceWith('/auth/register', {
      method: 'POST',
      body: { name: 'Manish', email, password: 'TestPassword123!' },
    });
    expect(onLogin).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Good to see you.' })).toBeVisible();
    expect(screen.getByLabelText('Email address')).toHaveValue(email);
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
  });

  test('shows login success for 1.5 seconds before opening the dashboard after separate login', async () => {
    const onLogin = vi.fn();
    const account = { id: 'account-id', name: 'Manish', email: 'alex@example.com' };
    api
      .mockResolvedValueOnce({ message: SIGNUP_SUCCESS_MESSAGE })
      .mockResolvedValueOnce({ user: account });
    render(<Auth onLogin={onLogin} />);
    const user = await fillSignup(account.email);
    await user.click(screen.getByRole('button', { name: 'Create account', exact: true }));
    expect(screen.getByRole('status')).toHaveTextContent(SIGNUP_SUCCESS_MESSAGE);
    expect(onLogin).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'TestPassword123!' } });
    vi.useFakeTimers();
    await submitLogin();
    expect(api).toHaveBeenLastCalledWith('/auth/login', {
      method: 'POST',
      body: { name: '', email: account.email, password: 'TestPassword123!' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Login successful!');
    expect(screen.getByRole('heading', { name: 'Good to see you.' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Opening your journal…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create an account', exact: true })).toBeDisabled();
    expect(screen.getByLabelText('Email address')).toBeDisabled();
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(onLogin).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1499);
    });
    expect(onLogin).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Login successful!');
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(onLogin).toHaveBeenCalledExactlyOnceWith(account);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('cancels the pending login transition when the login screen unmounts', async () => {
    vi.useFakeTimers();
    const onLogin = vi.fn();
    api.mockResolvedValue({
      user: { id: 'account-id', name: 'Manish', email: 'alex@example.com' },
    });
    const { unmount } = render(<Auth onLogin={onLogin} />);
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'alex@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'TestPassword123!' } });
    await submitLogin();
    expect(screen.getByRole('status')).toHaveTextContent('Login successful!');
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(onLogin).not.toHaveBeenCalled();
  });

  test('a rejected login never schedules a dashboard transition', async () => {
    vi.useFakeTimers();
    const onLogin = vi.fn();
    api.mockRejectedValue(new Error('Email or password is incorrect.'));
    render(<Auth onLogin={onLogin} />);
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'alex@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'IncorrectPassword' } });
    await submitLogin();
    expect(screen.getByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(onLogin).not.toHaveBeenCalled();
    expect(screen.queryByText('Login successful!')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in', exact: true })).toBeEnabled();
  });

  test.each([
    'manish@gmail',
    'manish@@gmail.com',
    'manish..name@gmail.com',
    '.alex@example.com',
    'manish@-gmail.com',
  ])('rejects malformed email %s in the form', async (email) => {
    const onLogin = vi.fn();
    render(<Auth onLogin={onLogin} />);
    const user = await fillSignup(email);
    await user.click(screen.getByRole('button', { name: 'Create account', exact: true }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter a valid email address.');
    expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid', 'true');
    expect(api).not.toHaveBeenCalled();
    expect(onLogin).not.toHaveBeenCalled();
  });

  test('failed signup keeps the user on signup and never displays a success message', async () => {
    const onLogin = vi.fn();
    api.mockRejectedValueOnce(
      Object.assign(new Error('An account with this email already exists.'), {
        fields: { email: 'Try logging in with this email.' },
      }),
    );
    render(<Auth onLogin={onLogin} />);
    const user = await fillSignup('alex@example.com');
    await user.click(screen.getByRole('button', { name: 'Create account', exact: true }));
    expect(await screen.findByText('An account with this email already exists.')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account', exact: true })).toBeVisible();
    expect(onLogin).not.toHaveBeenCalled();
  });
});
