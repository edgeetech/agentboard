import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useCopy } from './hooks';

interface CopyButtonProps {
  /** Text, or a function producing it lazily on click. */
  text: string | (() => string);
  label: ReactNode;
  title?: string;
  className?: string;
}

export function CopyButton({ text, label, title, className = 'ghost sm' }: CopyButtonProps) {
  const { t } = useTranslation();
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      className={className}
      title={title ?? (typeof text === 'string' ? text : undefined)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void copy(typeof text === 'string' ? text : text());
      }}
    >
      <span aria-live="polite">{copied ? t('common.copied', 'Copied') : label}</span>
    </button>
  );
}
