import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, test, expect, vi } from 'vitest';
import ReadingForm from './ReadingForm.jsx';

const defaults = {
  today: '2026-11-19',
  selectedDate: '2026-11-19',
  onSave: vi.fn(),
  onCancel: vi.fn(),
};
afterEach(() => vi.useRealTimers());
async function submitReading() {
  await act(async () => {
    fireEvent.submit(screen.getByRole('button', { name: 'Save reading' }).closest('form'));
  });
}

describe('Reading form', () => {
  test('shows a required-value message without submitting', async () => {
    vi.useFakeTimers();
    const save = vi.fn();
    render(<ReadingForm {...defaults} onSave={save} />);
    await submitReading();
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter a glucose value.');
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await submitReading();
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter a glucose value.');
    expect(save).not.toHaveBeenCalled();
  });
  test.each(['39', '601', '120.5'])('rejects invalid value %s', async (value) => {
    const save = vi.fn();
    render(<ReadingForm {...defaults} onSave={save} />);
    await userEvent.type(screen.getByLabelText('Glucose value'), value);
    await userEvent.click(screen.getByRole('button', { name: 'Save reading' }));
    expect(screen.getByRole('alert')).toHaveTextContent('whole number between 40 and 600');
    expect(save).not.toHaveBeenCalled();
  });
  test('submits a valid reading as a number and resets the value', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<ReadingForm {...defaults} onSave={save} />);
    await userEvent.selectOptions(screen.getByLabelText('Time slot'), 'after_lunch');
    await userEvent.type(screen.getByLabelText('Glucose value'), '123');
    await userEvent.click(screen.getByRole('button', { name: 'Save reading' }));
    expect(save).toHaveBeenCalledWith(
      { date: '2026-11-19', slot: 'after_lunch', value: 123 },
      undefined,
    );
    expect(screen.getByLabelText('Glucose value')).toHaveValue('');
  });
  test('surfaces a server duplicate-slot error and keeps the entered value', async () => {
    const save = vi.fn().mockRejectedValue(
      Object.assign(new Error('You already have an After lunch reading for this date.'), {
        fields: { slot: 'Choose another slot.' },
      }),
    );
    render(<ReadingForm {...defaults} onSave={save} />);
    await userEvent.type(screen.getByLabelText('Glucose value'), '123');
    await userEvent.click(screen.getByRole('button', { name: 'Save reading' }));
    expect(
      await screen.findByText('You already have an After lunch reading for this date.'),
    ).toBeVisible();
    expect(screen.getByLabelText('Time slot')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Glucose value')).toHaveValue('123');
  });
  test('edits a saved reading with its id and supports cancel', async () => {
    const save = vi.fn().mockResolvedValue(undefined),
      cancel = vi.fn();
    render(
      <ReadingForm
        {...defaults}
        reading={{ id: 'reading-id', date: '2026-11-18', slot: 'morning', value: 110 }}
        onSave={save}
        onCancel={cancel}
      />,
    );
    expect(screen.getByLabelText('Glucose value')).toHaveValue('110');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(save).toHaveBeenCalledWith(
      { date: '2026-11-18', slot: 'morning', value: 110 },
      'reading-id',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    expect(cancel).toHaveBeenCalledOnce();
  });
  test('clears duplicate-slot messages and highlighting after three seconds without clearing the draft', async () => {
    vi.useFakeTimers();
    const message = 'You already have an After breakfast reading for this date.';
    const save = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error(message), { fields: { slot: message } }));
    render(<ReadingForm {...defaults} onSave={save} />);
    fireEvent.change(screen.getByLabelText('Time slot'), { target: { value: 'after_breakfast' } });
    fireEvent.change(screen.getByLabelText('Glucose value'), { target: { value: '456' } });
    await submitReading();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    await act(async () => {
      vi.advanceTimersByTime(2999);
    });
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Time slot')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByLabelText('Time slot')).toHaveValue('after_breakfast');
    expect(screen.getByLabelText('Glucose value')).toHaveValue('456');
  });
  test('a repeated failed submission gets a fresh three-second message timeout', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockRejectedValue(new Error('Please try another slot.'));
    render(<ReadingForm {...defaults} onSave={save} />);
    fireEvent.change(screen.getByLabelText('Glucose value'), { target: { value: '456' } });
    await submitReading();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await submitReading();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Please try another slot.');
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Glucose value')).toHaveValue('456');
  });
});
