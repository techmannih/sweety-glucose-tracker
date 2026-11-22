import { Check } from 'lucide-react';

export const SUCCESS_TOAST_MS = 3000;

export default function SuccessToast({ message }) {
  if (!message) return null;
  return (
    <div className="success-toast" role="status">
      <Check size={18} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
