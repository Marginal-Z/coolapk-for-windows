import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Empty, ErrorNotice, LoadMore, Skeleton } from './components';
import { ClientError, plain, useResource } from './data';
import { EntityPoster } from './EntityPoster';
import type { Entity, Result } from './types';
import './topic-discovery.css';

type Category = { title: string; url: string };
type Props = { namespace: string; revision?: number; loggedIn: boolean; onLogin: () => void; onOpen: (entity: Entity) => void };

function categoriesFrom(result?: Result): { categories: Category[]; selectedTab: string } {
  const categories: Category[] = [], seen = new Set<string>();
  let selectedTab = '';
  function visit(items: unknown, depth = 0) {
    if (!Array.isArray(items) || depth > 8) return;
    for (const item of items.slice(0, 1000)) {
      if (!item || typeof item !== 'object') continue;
      if (item.entityTemplate === 'verticalColumnsFullPageCard' && !selectedTab) {
        let extra = item.extraDataArr;
        if (!extra && typeof item.extraData === 'string') { try { extra = JSON.parse(item.extraData); } catch { /* Missing optional selection metadata. */ } }
        selectedTab = plain(extra?.selectedTab || '');
      }
      if (item.entityType === 'verticalColumnsFullPage' && typeof item.url === 'string' && item.url && !seen.has(item.url)) {
        const title = plain(item.title || '');
        if (title) { seen.add(item.url); categories.push({ title, url: item.url }); }
      }
      visit(item.entities, depth + 1);
    }
  }
  visit(result?.surfaceItems);
  // Older normalizers flatten this card. Its original routes remain sufficient.
  if (!categories.length) visit(result?.data);
  return { categories, selectedTab };
}

function topicItems(result?: Result): Entity[] {
  const topics: Entity[] = [], seen = new Set<string>();
  function visit(items: unknown, depth = 0) {
    if (!Array.isArray(items) || depth > 8) return;
    for (const item of items.slice(0, 1000)) {
      if (!item || typeof item !== 'object') continue;
      if (item.entityType === 'topic') {
        const key = String(item.id ?? item.entityId ?? item.url ?? item.title);
        if (!seen.has(key)) { seen.add(key); topics.push(item); }
      } else visit(item.entities, depth + 1);
    }
  }
  // Prefer normalized topics from all loaded pages, retaining nested-card support.
  visit(result?.data);
  if (!topics.length) visit(result?.surfaceItems);
  return topics;
}

function needsAccount(url: string) {
  return /(?:^|\/)topic\/userFollowTagList(?:\?|$)/.test(url);
}

export function TopicDiscovery({ namespace, revision = 0, loggedIn, onLogin, onOpen }: Props) {
  const catalog = useResource('page', { url: 'V11_VERTICAL_TOPIC' }, namespace, revision);
  const { categories, selectedTab } = useMemo(() => categoriesFrom(catalog.data), [catalog.data]);
  const [selection, setSelection] = useState({ namespace, url: '' });
  const selected = categories.find(category => selection.namespace === namespace && category.url === selection.url)
    || categories.find(category => category.title === selectedTab) || categories[0];
  const loginRequired = !!selected && needsAccount(selected.url) && !loggedIn;
  const loginError = useMemo(() => new ClientError('登录后查看你关注的话题。', 'LOGIN_REQUIRED'), []);
  const resource = useResource(selected && !loginRequired ? 'page' : null, { url: selected?.url || '' }, namespace, revision);
  const topics = useMemo(() => topicItems(resource.data), [resource.data]);
  const baseId = useId(), buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const section = useRef<HTMLElement>(null);
  const selectedIndex = selected ? categories.indexOf(selected) : 0;
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const node = section.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width <= 620));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  function choose(index: number, focus = false) {
    const category = categories[index];
    if (!category) return;
    setSelection({ namespace, url: category.url });
    if (focus) { buttons.current[index]?.focus(); buttons.current[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = categories.length - 1;
    else if (['ArrowDown', 'ArrowRight'].includes(event.key)) next = (index + 1) % categories.length;
    else if (['ArrowUp', 'ArrowLeft'].includes(event.key)) next = (index + categories.length - 1) % categories.length;
    else return;
    event.preventDefault(); choose(next, true);
  }
  return <section ref={section} className="home-section topic-discovery" aria-label="发现话题">
    {catalog.error && <ErrorNotice error={catalog.error} onRetry={catalog.retry} onLogin={onLogin} />}
    {catalog.loading && !catalog.data ? <Skeleton /> : !categories.length ? !catalog.error && <Empty title="暂无话题分类" message="酷安还未返回话题分类，请稍后刷新。" /> : <div className="topic-discovery-layout">
      <nav className="topic-discovery-categories" aria-label="话题分类">
        <div role="tablist" aria-label="话题分类" aria-orientation={narrow ? 'horizontal' : 'vertical'}>
          {categories.map((category, index) => <button key={category.url} type="button" role="tab" id={`${baseId}-category-${index}`} aria-selected={index === selectedIndex} aria-controls={`${baseId}-topics`} tabIndex={index === selectedIndex ? 0 : -1} ref={node => { buttons.current[index] = node; }} onKeyDown={event => move(event, index)} onClick={() => choose(index)}>{category.title}</button>)}
        </div>
      </nav>
      <div className="topic-discovery-panel" role="tabpanel" id={`${baseId}-topics`} aria-labelledby={`${baseId}-category-${selectedIndex}`} aria-busy={resource.loading && !loginRequired} tabIndex={0}>
        <div className="topic-discovery-heading"><h2>{selected.title}</h2>{!loginRequired && topics.length > 0 && <span>已加载 {topics.length} 个话题</span>}</div>
        {loginRequired ? <ErrorNotice error={loginError} onLogin={onLogin} /> : <>
          {resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={onLogin} />}
          {resource.loading && !resource.data ? <Skeleton /> : <>
            <div className="entity-poster-grid topic-discovery-grid" aria-label="话题海报列表">{topics.map(topic => <div className="topic-discovery-topic" key={String(topic.id ?? topic.entityId ?? topic.url ?? topic.title)}><EntityPoster entity={topic} variant="topic" onOpen={onOpen} /></div>)}</div>
            {!topics.length && resource.data && !resource.error && <Empty title="暂无话题" message="这个分类还没有可显示的话题。" />}
          </>}
          {topics.length > 0 && <LoadMore loading={resource.loading} hasMore={resource.data?.hasMore} error={resource.error} onClick={resource.more} label="加载更多话题" className="topic-discovery-more" />}
        </>}
      </div>
    </div>}
  </section>;
}
