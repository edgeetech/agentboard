import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { FileDropZone } from './FileDropZone';

export function CreateTaskModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [filePaths, setFilePaths] = useState<string[]>([]);

  const m = useMutation({
    mutationFn: async () => {
      const { task } = await api.createTask({ title, description });
      const validPaths = filePaths.map(p => p.trim()).filter(Boolean);
      for (const fp of validPaths) {
        await api.addFilePath(task.code, fp);
      }
      return task;
    },
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
          <label>{t('files.label', 'File paths')}</label>
          <FileDropZone paths={filePaths} onChange={setFilePaths} />
          <div className="actions">
            <button type="button" onClick={onClose}>{t('common.cancel', 'Cancel')}</button>
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
