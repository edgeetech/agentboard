import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { api } from '../api';

import { CopyIcon } from './CopyIcon';

export function PromptPanel({
  kind, id, onClose,
}: { kind: 'role' | 'skill'; id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['prompt', kind, id],
    queryFn: () => api.prompt(kind, id),
    retry: false,
  });

  async function copy() {
    try { await navigator.clipboard.writeText(q.data?.content ?? ''); } catch {}
  }

  return (
    <aside className="prompt-panel">
      <div className="prompt-head">
        <span className="tag">{kind}.md</span>
        {q.data?.path && <span className="mono muted prompt-path">{q.data.path}</span>}
        <span style={{ flex: 1 }} />
        <button
          className="icon-btn"
          type="button"
          onClick={copy}
          disabled={!q.data?.content}
          title={t('prompt.copy', 'Copy')}
          aria-label={t('prompt.copy', 'Copy')}
        >
          <CopyIcon />
        </button>
        <button
          className="icon-btn"
          type="button"
          onClick={onClose}
          title={t('common.close', 'Close')}
          aria-label={t('common.close', 'Close')}
        >×</button>
      </div>
      <div className="prompt-body">
        {q.isLoading && <div className="center"><div className="spinner" /></div>}
        {q.isError && (
          <div className="muted" style={{ padding: '0.75rem' }}>
            {(() => {
              const raw = String((q.error)?.message || 'error');
              if (raw === 'prompt not found') return t('prompt.not_found', 'Prompt not found');
              return raw;
            })()}
          </div>
        )}
        {!q.isLoading && !q.isError && !q.data?.content && (
          <div className="muted" style={{ padding: '0.75rem' }}>
            {t('prompt.missing', 'No prompt file for this {{kind}} yet.', { kind })}
          </div>
        )}
        {q.data?.content && <pre className="prompt-md">{q.data.content}</pre>}
      </div>
    </aside>
  );
}
