import { useCallback, useEffect, useState } from 'react';

export type CardView = 'modern' | 'classic';
const KEY = 'ab.cardview';

export function useCardView(): [CardView, (v: CardView) => void] {
  const [view, setView] = useState<CardView>(() => {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'classic' ? 'classic' : 'modern';
    } catch { return 'modern'; }
  });
  useEffect(() => {
    try { localStorage.setItem(KEY, view); } catch {}
  }, [view]);
  const set = useCallback((v: CardView) => setView(v), []);
  return [view, set];
}
