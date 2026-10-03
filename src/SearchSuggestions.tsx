import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Search } from 'lucide-react';
import { call, plain } from './data';
import type { Entity } from './types';
import { suggestionSelection, type SearchSuggestionSelection } from './search-targets';
import './SearchSuggestions.css';
export type { SearchSuggestionSelection } from './search-targets';
export type SearchSuggestionsProps = { query: string; namespace: string; inputRef: RefObject<HTMLInputElement | null>; active?: boolean; scope?: 'all' | 'app'; onSelect: (selection: SearchSuggestionSelection) => void; onDismiss?: () => void };

export function SearchSuggestions({ query, namespace, inputRef, active = true, scope = 'all', onSelect, onDismiss }: SearchSuggestionsProps) {
  const [storedRows, setRows] = useState<Entity[]>([]), [resultKey, setResultKey] = useState(''), [loading, setLoading] = useState(false), [error, setError] = useState(''), [index, setIndex] = useState(-1), [dismissed, setDismissed] = useState('');
  const version = useRef(0), listId = 'search-suggestions-' + useId(), key = namespace + ':' + scope + ':' + query.trim();
  const rows = resultKey === key ? storedRows : [];
  const visible = active && !!query.trim() && dismissed !== key && (loading || !!rows.length || !!error);
  useEffect(() => {
    const current = ++version.current; setRows([]); setIndex(-1); setError(''); setLoading(false);
    if (!active || !query.trim()) return;
    const timer = setTimeout(() => {
      setLoading(true);
      void (async () => {
        let result = await call(scope === 'app' ? 'searchSuggestionsApp' : 'searchSuggestions', { query: query.trim() });
        if (current !== version.current) return;
        if (scope === 'app' && Array.isArray(result.data) && !result.data.length) result = await call('searchSuggestions', { query: query.trim() });
        if (current !== version.current) return;
        setRows((Array.isArray(result.data) ? result.data : []).slice(0, 8)); setResultKey(key);
      })().catch(() => { if (current === version.current) setError('搜索建议暂不可用，仍可直接搜索。'); }).finally(() => { if (current === version.current) setLoading(false); });
    }, 300);
    return () => { clearTimeout(timer); version.current++; };
  }, [query, namespace, scope, active]);
  function dismiss() { setDismissed(key); setIndex(-1); onDismiss?.(); }
  function choose(row: Entity) { const selection = suggestionSelection(row); dismiss(); onSelect(selection.kind === 'search' ? { ...selection, query: plain(selection.query) } : selection); }
  useEffect(() => {
    const input = inputRef.current; if (!input) return;
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', String(visible)); input.setAttribute('aria-controls', listId);
    if (visible && index >= 0) input.setAttribute('aria-activedescendant', listId + '-' + index); else input.removeAttribute('aria-activedescendant');
    const keydown = (event: KeyboardEvent) => {
      if (!visible) return;
      if (['ArrowDown', 'ArrowUp'].includes(event.key) && rows.length) { event.preventDefault(); setIndex(old => event.key === 'ArrowDown' ? (old + 1) % rows.length : old <= 0 ? rows.length - 1 : old - 1); }
      else if (event.key === 'Enter' && index >= 0 && rows[index]) { event.preventDefault(); choose(rows[index]); }
      else if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    };
    const blur = () => dismiss(), focus = () => setDismissed(''); input.addEventListener('keydown', keydown); input.addEventListener('blur', blur); input.addEventListener('focus', focus);
    return () => { input.removeEventListener('keydown', keydown); input.removeEventListener('blur', blur); input.removeEventListener('focus', focus); };
  }, [visible, index, rows, listId, query, namespace, onSelect, onDismiss]);
  useEffect(() => () => { const input = inputRef.current; if (input) for (const name of ['role', 'aria-autocomplete', 'aria-expanded', 'aria-controls', 'aria-activedescendant']) input.removeAttribute(name); }, [inputRef]);
  if (!visible) return null;
  return <div className="search-suggestions"><div id={listId} role="listbox" aria-label="搜索建议">{rows.map((row, i) => <button type="button" role="option" id={listId + '-' + i} key={String(row.url || row.id || '') + ':' + i} aria-selected={index === i} tabIndex={-1} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setIndex(i)} onClick={() => choose(row)}><Search size={15} aria-hidden="true" /><span>{plain(row.title || row.searchValue || row.name || row.username || row.entityTitle)}</span>{row.subTitle && <small>{plain(row.subTitle)}</small>}</button>)}</div>{loading && <p role="status">正在查找搜索建议…</p>}{error && <p role="status">{error}</p>}</div>;
}
