import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';

export function CreateTaskModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const m = useMutation({
    mutationFn: () => api.createTask({ title, description }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    },
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{t('board.new_task')}</h2>
        <form onSubmit={e => { e.preventDefault(); m.mutate(); }}>
          <label>{t('task.title')}
            <input value={title} onChange={e => setTitle(e.target.value)} required autoFocus />
          </label>
          <label>{t('task.description')}
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} />
          </label>
          <div className="actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={!title.trim() || m.isPending}>
              {t('board.new_task')}
            </button>
          </div>
          {m.isError && <div className="err">{(m.error as Error).message}</div>}
        </form>
      </div>
    </div>
  );
}
