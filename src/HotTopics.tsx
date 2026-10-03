import { Hash } from 'lucide-react';
import { ErrorNotice } from './components';
import { count, plain, useResource } from './data';
import type { Entity } from './types';

export function HotTopics({ namespace, onTopic, onLogin }: { namespace: string; onTopic: (tag: string) => void; onLogin?: () => void }) {
  const resource = useResource('homeHotTopics', {}, namespace);
  const topics: Entity[] = Array.isArray(resource.data?.data) ? resource.data.data : [];
  return <section className="rail-section" aria-label="热门话题">
    <h2><Hash size={18} />热门话题</h2>
    {resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={onLogin} />}
    {resource.loading && !resource.data && <p className="muted" role="status">正在加载话题…</p>}
    {!resource.loading && !resource.error && !topics.length && <p className="muted">暂无热门话题</p>}
    {topics.length > 0 && <div className="hot-words">{topics.map((topic, index) => <button key={topic.tag + ':' + index} onClick={() => onTopic(topic.tag)}>
      <span>#</span><strong>{plain(topic.tag)}</strong><small className="muted">热度 {count(topic.count)}</small>
    </button>)}</div>}
  </section>;
}
