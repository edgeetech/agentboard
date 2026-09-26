import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'danger';

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

interface ToastState {
  toasts: ToastItem[];
  push: (message: string, tone?: ToastTone) => string;
  dismiss: (id: string) => void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, tone = 'info') => {
    const id = `t${(seq += 1)}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    return id;
  },
  dismiss: (id) => { set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })); },
}));

/** Non-hook helper for imperative call sites (mutation onError, etc). */
export const toast = {
  info: (message: string) => useToastStore.getState().push(message, 'info'),
  success: (message: string) => useToastStore.getState().push(message, 'success'),
  danger: (message: string) => useToastStore.getState().push(message, 'danger'),
};
