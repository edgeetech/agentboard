import { useEffect, useRef, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(id);
    };
  }, [value, delayMs]);
  return debounced;
}

/**
 * Calls `onVisible` whenever the returned sentinel ref scrolls within
 * `rootMargin` of the viewport — drives infinite loading without scroll math.
 */
export function useSentinel<T extends Element>(
  onVisible: () => void,
  enabled: boolean,
  rootMargin = '600px',
) {
  const ref = useRef<T | null>(null);
  const callback = useRef(onVisible);
  callback.current = onVisible;

  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) callback.current();
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [enabled, rootMargin]);

  return ref;
}

/** Copy text to the clipboard and expose a short-lived "copied" flag. */
export function useCopy(resetMs = 1800) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => {
      setCopied(false);
    }, resetMs);
    return () => {
      clearTimeout(id);
    };
  }, [copied, resetMs]);

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* clipboard blocked (insecure context / permissions) — leave state unchanged */
    }
  }
  return { copied, copy };
}
