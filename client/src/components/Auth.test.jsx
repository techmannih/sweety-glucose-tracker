import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import Auth from './Auth.jsx';
import { api } from '../api.js';
import { SIGNUP_SUCCESS_MESSAGE } from '../../../shared/auth.js';

vi.mock('../api.js', () => ({ api: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

async function fillSignup(email) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Create an account', exact: true }));
  await user.type(screen.getByLabelText('Your name'), 'Manish');
  await user.type(screen.getByLabelText('Email address'), email);
  await user.type(screen.getByLabelText('Password'), 'TestPassword123!');
  return user;
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

  test('opens the dashboard only after the user submits a separate successful login', async () => {
    const onLogin = vi.fn();
    const account = { id: 'account-id', name: 'Manish', email: 'alex@example.com' };
    api
      .mockResolvedValueOnce({ message: SIGNUP_SUCCESS_MESSAGE })
      .mockResolvedValueOnce({ user: account });
    render(<Auth onLogin={onLogin} />);
    const user = await fillSignup(account.email);
    await user.click(screen.getByRole('button', { name: 'Create account', exact: true }));
    await screen.findByRole('status');
    expect(onLogin).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Password'), 'TestPassword123!');
    await user.click(screen.getByRole('button', { name: 'Log in', exact: true }));
    expect(api).toHaveBeenLastCalledWith('/auth/login', {
      method: 'POST',
      body: { name: '', email: account.email, password: 'TestPassword123!' },
    });
    expect(onLogin).toHaveBeenCalledExactlyOnceWith(account);
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
