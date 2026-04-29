import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  paths: string[];
  onChange: (paths: string[]) => void;
}

export function FileDropZone({ paths, onChange }: Props) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addPaths(newPaths: string[]) {
    const deduped = newPaths.filter(p => p && !paths.includes(p));
    if (deduped.length) onChange([...paths, ...deduped]);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const names = Array.from(e.dataTransfer.files).map(f => f.name);
    if (names.length) addPaths(names);
  }

  function handleUpdate(idx: number, value: string) {
    const next = [...paths];
    next[idx] = value;
    onChange(next);
  }

  function handleRemove(idx: number) {
    onChange(paths.filter((_, i) => i !== idx));
  }

  function handleAddEmpty() {
    onChange([...paths, '']);
    // Focus the new input on next tick
    setTimeout(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>('.file-path-entry input');
      inputs[inputs.length - 1]?.focus();
    }, 0);
  }

  return (
    <div className="file-drop-zone-wrap">
      <div
        className={`file-drop-zone${dragging ? ' drag-over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <span className="file-drop-icon">📎</span>
        <span className="file-drop-label">
          {t('files.drop_hint', 'Drop files here or click to browse')}
        </span>
        <span className="file-drop-sub">
          {t('files.drop_sub', 'File name is pre-filled — edit to provide the full path')}
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={e => {
            const names = Array.from(e.target.files ?? []).map(f => f.name);
            addPaths(names);
            e.target.value = '';
          }}
        />
      </div>

      {paths.length > 0 && (
        <ul className="file-path-list">
          {paths.map((p, i) => (
            <li key={i} className="file-path-entry">
              <span className="file-path-icon">📄</span>
              <input
                type="text"
                value={p}
                onChange={e => handleUpdate(i, e.target.value)}
                placeholder={t('files.path_placeholder', '/absolute/path/to/file')}
              />
              <button
                type="button"
                className="icon-btn danger-hover"
                onClick={() => handleRemove(i)}
                title={t('common.remove', 'Remove')}
                aria-label={t('common.remove', 'Remove')}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="ghost file-add-btn" onClick={handleAddEmpty}>
        + {t('files.add_path', 'Add file path')}
      </button>
    </div>
  );
}
