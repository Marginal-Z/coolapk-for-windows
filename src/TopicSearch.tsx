import { useState, type ComponentProps } from 'react';
import { Search, X } from 'lucide-react';
import { Empty, EntityCard, ErrorNotice, FeedCard, LoadMore, Skeleton } from './components';
import { plain, useResource } from './data';
import type { Entity } from './types';
import './topic-search.css';

export type TopicSearchProps = {
  tag: string;
  namespace: string;
  feedProps: Omit<ComponentProps<typeof FeedCard>, 'feed'>;
  onOpenEntity: (entity: Entity) => void;
};
const sorts = [['default', '综合'], ['latest', '实时'], ['hot', '热度'], ['comment', '评论'], ['accurate', '精确']];
const types = [['all', '全部'], ['feed', '动态'], ['feedArticle', '图文'], ['picture', '酷图'], ['question', '提问'], ['answer', '回答'], ['comment', '评论'], ['video', '视频'], ['ershou', '二手'], ['vote', '投票']];
const feedTypes = new Set(['feed', 'feedArticle', 'question', 'answer', 'feedQuestion', 'feedAnswer', 'dyhArticle']);

export function TopicSearch(props: TopicSearchProps) {
  return <TopicSearchForm key={JSON.stringify([props.namespace, props.tag])} {...props} />;
}

function TopicSearchForm({ tag, namespace, feedProps, onOpenEntity }: TopicSearchProps) {
  const [query, setQuery] = useState(''), [submitted, setSubmitted] = useState('');
  const [sort, setSort] = useState('default'), [feedType, setFeedType] = useState('all'), [revision, setRevision] = useState(0);
  const resource = useResource(submitted ? 'topicSearch' : null, { tag, query: submitted, sort, feedType, page: 1 }, namespace, revision);
  const items: Entity[] = Array.isArray(resource.data?.data) ? resource.data.data : [];
  function clear() { setQuery(''); setSubmitted(''); setSort('default'); setFeedType('all'); }
  return <section className="topic-search" aria-label="话题内搜索">
    <form className="topic-search-form" onSubmit={event => { event.preventDefault(); const value = query.trim(); if (value) { setSubmitted(value); setRevision(value => value + 1); } }}>
      <label>搜索当前话题<input type="search" aria-label="话题内搜索关键词" placeholder={`在 #${plain(tag)}# 中搜索`} maxLength={200} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button className="button secondary" type="submit" disabled={!query.trim()}><Search size={15} />搜索话题</button>
      {(submitted || query) && <button className="text-button" type="button" onClick={clear}><X size={15} />清空搜索</button>}
    </form>
    {submitted && <>
      <div className="topic-search-controls"><label>搜索排序<select aria-label="话题搜索排序" value={sort} onChange={event => setSort(event.target.value)}>{sorts.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>内容类型<select aria-label="话题搜索内容类型" value={feedType} onChange={event => setFeedType(event.target.value)}>{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <p className="topic-search-scope">当前话题：#{plain(tag)}# · 搜索“{submitted}”</p>
      {resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={feedProps.onLogin} />}
      {resource.loading && !resource.data && <Skeleton />}
      {!resource.loading && !resource.error && !items.length && <Empty title="当前话题没有搜索结果" message="试试其他关键词或内容类型。" />}
      <div className="feed-list">{items.map((item, index) => {
        const key = String(item.entityType || '') + ':' + String(item.id ?? item.entityId ?? index);
        return feedTypes.has(item.entityType) && /^[1-9]\d*$/.test(String(item.id)) ? <FeedCard key={key} {...feedProps} feed={item} /> : <EntityCard key={key} entity={item} onOpen={onOpenEntity} onUser={feedProps.onUser} onLink={feedProps.onLink} />;
      })}</div>
      {resource.data && <LoadMore loading={resource.loading} hasMore={resource.data.hasMore} onClick={resource.more} />}
    </>}
  </section>;
}
export default TopicSearch;
