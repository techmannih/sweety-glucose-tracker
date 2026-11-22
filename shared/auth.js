import isEmail from 'validator/lib/isEmail.js';

export const SIGNUP_SUCCESS_MESSAGE = 'Sign up successful! Please log in to continue.';
export const ACCOUNT_HEADER = 'X-Sweety-Account';

export function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function isValidEmail(email) {
  return (
    typeof email === 'string' &&
    isEmail(email.trim(), {
      allow_display_name: false,
      allow_utf8_local_part: false,
      require_tld: true,
      allow_ip_domain: false,
    })
  );
}

// Shared by the form and API so both show the same validation messages.
// This validates email syntax, not mailbox existence or ownership.
export function validateAuth(input, { register = false } = {}) {
  const fields = {};
  if (
    register &&
    (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80)
  )
    fields.name = 'Enter a name between 1 and 80 characters.';
  if (!isValidEmail(input.email)) fields.email = 'Please enter a valid email address.';
  if (typeof input.password !== 'string' || !input.password.length) {
    fields.password = 'Please enter your password.';
  } else if (
    (register && input.password.length < 8) ||
    new TextEncoder().encode(input.password).length > 72
  ) {
    fields.password = register
      ? 'Use at least 8 characters and at most 72 UTF-8 bytes.'
      : 'Password must be at most 72 UTF-8 bytes.';
  }
  return fields;
}
