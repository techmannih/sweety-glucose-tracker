import { useEffect, useState } from 'react';
import { Plus, Check, Pencil, X } from 'lucide-react';
import { SLOTS, validateReading } from '../../../shared/domain.js';

export default function ReadingForm({
  today,
  selectedDate,
  initialSlot = 'morning',
  reading,
  saving = false,
  onSave,
  onCancel,
}) {
  const isEditing = Boolean(reading?.id);
  const [form, setForm] = useState(reading || { date: selectedDate, slot: initialSlot, value: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!reading && !dirty)
      setForm((old) => (old.slot === initialSlot ? old : { ...old, slot: initialSlot }));
  }, [initialSlot, reading, dirty]);
  useEffect(() => {
    if (!message && !Object.values(errors).some(Boolean)) return;
    const timer = setTimeout(() => {
      setErrors({});
      setMessage('');
    }, 3000);
    return () => clearTimeout(timer);
  }, [errors, message]);
  const update = (event) => {
    const { name, value } = event.target;
    setDirty(true);
    setForm((old) => ({ ...old, [name]: value }));
    setErrors((old) => ({ ...old, [name]: undefined }));
    setMessage('');
  };
  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    const nextErrors = validateReading(form, today);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setMessage('');
    try {
      await onSave({ date: form.date, slot: form.slot, value: Number(form.value) }, reading?.id);
      if (!reading) {
        setForm((old) => ({ ...old, value: '' }));
        setDirty(false);
      }
    } catch (error) {
      setErrors(error.fields || {});
      setMessage(error.message);
    }
  }
  return (
    <section className="panel form-panel" id="reading-form" aria-labelledby="form-heading">
      <div className="panel-title">
        <span className="icon-tile">{isEditing ? <Pencil size={20} /> : <Plus size={22} />}</span>
        <h2 id="form-heading">{isEditing ? 'Edit reading' : 'Add a reading'}</h2>
        {reading && (
          <button
            className="icon-button"
            onClick={onCancel}
            aria-label="Cancel edit"
            disabled={saving}
          >
            <X size={18} />
          </button>
        )}
      </div>
      <p className="muted">A quick check-in for your daily journal.</p>
      <form onSubmit={submit} aria-busy={saving} noValidate>
        <label htmlFor="reading-date">Date</label>
        <input
          id="reading-date"
          name="date"
          type="date"
          max={today}
          min="1900-01-01"
          value={form.date}
          disabled={saving}
          onChange={update}
          aria-invalid={!!errors.date}
          aria-describedby={errors.date ? 'date-error' : undefined}
        />
        {errors.date && (
          <p className="field-error" id="date-error" role="alert">
            {errors.date}
          </p>
        )}
        <label htmlFor="reading-slot">Time slot</label>
        <select
          id="reading-slot"
          name="slot"
          value={form.slot}
          disabled={saving}
          onChange={update}
          aria-invalid={!!errors.slot}
          aria-describedby={errors.slot ? 'slot-error' : undefined}
        >
          {SLOTS.map((slot) => (
            <option key={slot.value} value={slot.value}>
              {slot.label}
            </option>
          ))}
        </select>
        {errors.slot && (
          <p className="field-error" id="slot-error" role="alert">
            {errors.slot}
          </p>
        )}
        <label htmlFor="reading-value">Glucose value</label>
        <div className="value-input">
          <input
            id="reading-value"
            name="value"
            inputMode="numeric"
            type="text"
            placeholder="e.g. 110"
            value={form.value}
            disabled={saving}
            onChange={update}
            aria-invalid={!!errors.value}
            aria-describedby={errors.value ? 'value-error value-hint' : 'value-hint'}
          />
          <span>mg/dl</span>
        </div>
        <p className="input-hint" id="value-hint">
          Whole numbers from 40 to 600.
        </p>
        {errors.value && (
          <p className="field-error" id="value-error" role="alert">
            {errors.value}
          </p>
        )}
        {message && (
          <div className="alert" role="alert">
            {message}
          </div>
        )}
        <button className="primary full" disabled={saving} type="submit">
          {saving ? (
            'Saving…'
          ) : (
            <>
              <Check size={18} />
              {isEditing ? 'Save changes' : 'Save reading'}
            </>
          )}
        </button>
        {reading && (
          <button type="button" className="text-button full" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
      </form>
      <div className="form-footnote">One reading per time slot. Four per day.</div>
    </section>
  );
}
