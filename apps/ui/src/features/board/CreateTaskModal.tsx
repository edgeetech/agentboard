import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, type ApiSkill } from '../../api';
import { loadRoles } from '../../data/catalog';

import { FileDropZone } from './FileDropZone';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MentionItem {
  id: string;
  name: string;
  emblem: string;
  group: 'Personas' | 'Skills';
}

// ---------------------------------------------------------------------------
// Hook: detect @-mention trigger from textarea state
// Returns { query, anchorPos } or null when not in a mention context.
// ---------------------------------------------------------------------------

function getMentionContext(
  text: string,
  cursorPos: number,
): { query: string; anchorPos: number } | null {
  const textBefore = text.slice(0, cursorPos);
  // Walk backwards from cursor to find the last @
  const atIdx = textBefore.lastIndexOf('@');
  if (atIdx === -1) return null;
  // AC7: @ must be at position 0 OR preceded by whitespace
  if (atIdx > 0 && !/\s/.test(textBefore[atIdx - 1])) return null;
  // The query is the text between @ and the cursor (no spaces allowed inside)
  const query = textBefore.slice(atIdx + 1);
  if (/\s/.test(query)) return null;
  return { query, anchorPos: atIdx };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateTaskModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [assignee_role, setAssigneeRole] = useState<string | null>(null);

  // Council is a *mode* of an existing role (configured at project level),
  // not a standalone assignee — exclude it from the dropdown.
  const personas = useMemo(() => loadRoles().filter((r) => r.id !== 'council'), []);

  // Skills loaded from /api/skills on first @-trigger.
  // Use loading sentinel (not loaded) so transient failures retry on next trigger.
  const [skills, setSkills] = useState<ApiSkill[]>([]);
  const skillsLoadingRef = useRef(false);
  const skillsLoadedRef = useRef(false);

  // @-mention state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null = closed
  const [mentionAnchor, setMentionAnchor] = useState(0); // position of @ in text
  const [activeIdx, setActiveIdx] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);

  // Build filtered mention items
  const mentionItems = useMemo<MentionItem[]>(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const personaItems: MentionItem[] = personas
      .filter((p) => p.name.toLowerCase().includes(q))
      .map((p) => ({ id: p.id, name: p.name, emblem: p.emblem, group: 'Personas' as const }));
    const skillItems: MentionItem[] = skills
      .filter((s) => s.name.toLowerCase().includes(q))
      .map((s) => ({ id: s.id, name: s.name, emblem: s.emblem, group: 'Skills' as const }));
    return [...personaItems, ...skillItems];
  }, [mentionQuery, personas, skills]);

  // Keep activeIdx in range
  useEffect(() => {
    setActiveIdx(0);
  }, [mentionItems.length]);

  // Close dropdown on outside click
  useEffect(() => {
    if (mentionQuery === null) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setMentionQuery(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => { document.removeEventListener('mousedown', handler); };
  }, [mentionQuery]);

  // Load skills lazily. Retry on transient failure: only mark loaded after success.
  const ensureSkillsLoaded = () => {
    if (skillsLoadedRef.current || skillsLoadingRef.current) return;
    skillsLoadingRef.current = true;
    api.listSkills()
      .then(({ skills: s }) => {
        setSkills(s);
        skillsLoadedRef.current = true;
      })
      .catch(() => { /* swallow; next @-trigger will retry */ })
      .finally(() => { skillsLoadingRef.current = false; });
  };

  // Handle textarea change
  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setDescription(val);
    const cursor = e.target.selectionStart ?? val.length;
    const ctx = getMentionContext(val, cursor);
    if (ctx) {
      ensureSkillsLoaded();
      setMentionQuery(ctx.query);
      setMentionAnchor(ctx.anchorPos);
    } else {
      setMentionQuery(null);
    }
  };

  // Insert a mention item at cursor
  const selectItem = (item: MentionItem) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const before = description.slice(0, mentionAnchor);
    const after = description.slice(ta.selectionStart ?? description.length);
    const inserted = `@${item.name}`;
    const newVal = `${before}${inserted}${after}`;
    setDescription(newVal);
    setMentionQuery(null);
    // Restore focus + cursor position after React re-render
    const newCursor = before.length + inserted.length;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCursor, newCursor);
    });
  };

  // Keyboard navigation inside textarea
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery === null || mentionItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, mentionItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectItem(mentionItems[activeIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setMentionQuery(null);
    }
  };

  // Scroll active item into view
  useEffect(() => {
    const el = dropdownRef.current?.querySelector(`[data-idx="${activeIdx}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const m = useMutation({
    mutationFn: async () => {
      const { task } = await api.createTask({ title, description, assignee_role });
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

  // Group items for rendering
  const personaItems = mentionItems.filter((i) => i.group === 'Personas');
  const skillItems = mentionItems.filter((i) => i.group === 'Skills');

  // Compute flat index offset for skills group (for activeIdx tracking)
  const skillOffset = personaItems.length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => { e.stopPropagation(); }}>
        <h2>{t('board.new_task')}</h2>
        <form onSubmit={e => { e.preventDefault(); m.mutate(); }}>
          <label>{t('task.title')}
            <input value={title} onChange={e => { setTitle(e.target.value); }} required autoFocus />
          </label>
          <label>{t('task.description')}
            <div className="mention-wrap">
              <textarea
                ref={textareaRef}
                value={description}
                onChange={handleDescriptionChange}
                onKeyDown={handleKeyDown}
                rows={4}
              />
              {mentionQuery !== null && mentionItems.length > 0 && (
                <ul className="mention-dropdown" ref={dropdownRef} role="listbox">
                  {personaItems.length > 0 && (
                    <>
                      <li className="mention-group-label">Personas</li>
                      {personaItems.map((item, i) => (
                        <li
                          key={item.id}
                          data-idx={i}
                          className={`mention-item${activeIdx === i ? ' is-active' : ''}`}
                          role="option"
                          aria-selected={activeIdx === i}
                          onMouseDown={e => { e.preventDefault(); selectItem(item); }}
                          onMouseEnter={() => { setActiveIdx(i); }}
                        >
                          <span className="mention-emblem">{item.emblem}</span>
                          <span className="mention-name">{item.name}</span>
                        </li>
                      ))}
                    </>
                  )}
                  {skillItems.length > 0 && (
                    <>
                      <li className="mention-group-label">Skills</li>
                      {skillItems.map((item, i) => {
                        const flatIdx = skillOffset + i;
                        return (
                          <li
                            key={item.id}
                            data-idx={flatIdx}
                            className={`mention-item${activeIdx === flatIdx ? ' is-active' : ''}`}
                            role="option"
                            aria-selected={activeIdx === flatIdx}
                            onMouseDown={e => { e.preventDefault(); selectItem(item); }}
                            onMouseEnter={() => { setActiveIdx(flatIdx); }}
                          >
                            <span className="mention-emblem">{item.emblem}</span>
                            <span className="mention-name">{item.name}</span>
                          </li>
                        );
                      })}
                    </>
                  )}
                </ul>
              )}
            </div>
          </label>
          <label>{t('task.assignee', 'Assign to')}
            <select value={assignee_role || ''} onChange={e => { setAssigneeRole(e.target.value || null); }}>
              <option value="">{t('task.unassigned', 'Unassigned (no agent)')}</option>
              {personas.map(p => (
                <option key={p.id} value={p.id}>
                  {p.emblem} {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>{t('files.label', 'File paths')}</label>
          <FileDropZone paths={filePaths} onChange={setFilePaths} />
          <div className="actions">
            <button type="button" onClick={onClose}>{t('common.cancel', 'Cancel')}</button>
            <button type="submit" disabled={!title.trim() || m.isPending}>
              {t('board.new_task')}
            </button>
          </div>
          {m.isError && <div className="err">{(m.error).message}</div>}
        </form>
      </div>
    </div>
  );
}
