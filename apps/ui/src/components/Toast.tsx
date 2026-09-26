import { useEffect } from 'react';

import { Icon } from './Icon';
import { useToastStore } from './toastStore';

const AUTO_DISMISS_MS = 5000;

/** Mount once near the app root. Accessible toast host — aria-live polite,
 *  auto-dismisses, each toast is also individually closeable. */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="toast-host" aria-live="polite" aria-atomic="false">
      {toasts.map((item) => (
        <ToastRow key={item.id} id={item.id} message={item.message} tone={item.tone} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function ToastRow({
  id, message, tone, onDismiss,
}: { id: string; message: string; tone: 'info' | 'success' | 'danger'; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => { onDismiss(id); }, AUTO_DISMISS_MS);
    return () => { clearTimeout(timer); };
  }, [id, onDismiss]);

  return (
    <div className={`toast toast-${tone}`} role="status">
      {tone === 'danger' && <Icon name="alert-circle" size={16} />}
      {tone === 'success' && <Icon name="check" size={16} />}
      <span className="toast-message">{message}</span>
      <button
        type="button"
        className="toast-close"
        onClick={() => { onDismiss(id); }}
        aria-label="Dismiss"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}
