import { useCallback, useEffect, useState } from 'react';

export type DetailView = 'panel' | 'page';
const KEY = 'ab.detailview';

export function useDetailView(): [DetailView, (v: DetailView) => void] {
  const [view, setView] = useState<DetailView>(() => {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'page' ? 'page' : 'panel';
    } catch { return 'panel'; }
  });
  useEffect(() => {
    try { localStorage.setItem(KEY, view); } catch {}
  }, [view]);
  return [view, useCallback((v: DetailView) => setView(v), [])];
}
