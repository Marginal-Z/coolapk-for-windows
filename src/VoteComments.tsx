import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { Avatar, Empty, ErrorNotice, LoadMore, Modal, RichText, Skeleton } from './components';
import { plain, relativeTime, useResource } from './data';
import { hasVoteAdminPrivilege, voteCommentRecommendation } from '../core/vote-comment-admin.mjs';
import type { Entity } from './types';

type Props = {
  id: string;
  namespace: string;
  loggedIn: boolean;
  onLogin: () => void;
  onLink?: (url: string) => void;
  onUser?: (uid: string, title: string) => void;
  onRecommend?: (commentId: string, type: 0 | 1, onSuccess: () => void) => void;
  recommendationBusy?: boolean;
  recommendationError?: any;
  onRetryRecommendation?: () => void;
};
const numeric = (value: unknown) => /^[1-9]\d{0,19}$/.test(String(value ?? '')) ? String(value) : '';
export function VoteComments(props: Props) {
  const scope = JSON.stringify([props.namespace, props.id]), [opened, setOpened] = useState('');
  const profile = useResource(props.loggedIn && opened === scope ? 'accountProfile' : null, {}, props.namespace);
  const adminType = profile.data?.data?.admintype ?? profile.data?.data?.adminType;
  return <><button className="text-button" type="button" disabled={!numeric(props.id)} onClick={() => setOpened(scope)}><MessageCircle size={15} />投票讨论</button>{opened === scope && <Modal title="投票讨论" onClose={() => setOpened('')}><VoteCommentList key={scope} {...props} isAdmin={props.loggedIn && hasVoteAdminPrivilege(adminType)} adminType={adminType} profileError={profile.error} profileRetry={profile.retry} /></Modal>}</>;
}
function VoteCommentList({ id, namespace, onLogin, onLink, onUser, isAdmin, adminType, onRecommend, recommendationBusy, recommendationError, onRetryRecommendation, profileError, profileRetry }: Props & { isAdmin: boolean; adminType: unknown; profileError?: any; profileRetry: () => void }) {
  const resource = useResource('voteComments', { id }, namespace);
  const [recommendationOverrides, setRecommendationOverrides] = useState<Record<string, boolean>>({});
  const rows: Entity[] = Array.isArray(resource.data?.data) ? resource.data!.data.filter((row: any) => row && typeof row === 'object' && !Array.isArray(row)) : [];
  return <section className="vote-discussion" aria-label="投票专用讨论列表">
    {profileError && <ErrorNotice error={profileError} onRetry={profileRetry} onLogin={onLogin} />}
    {recommendationError && <ErrorNotice error={recommendationError} onRetry={onRetryRecommendation || (() => {})} onLogin={onLogin} />}
    {resource.error && <ErrorNotice error={resource.error} onRetry={resource.retry} onLogin={onLogin} />}
    {resource.loading && !resource.data && <Skeleton />}
    {!resource.loading && !resource.error && !rows.length && <Empty title="暂无投票讨论" />}
    {rows.map((row, index) => {
      const name = plain(row.username || row.userInfo?.username || '酷友'), uid = numeric(row.uid || row.userInfo?.uid);
      const feedId = ['feed', 'question', 'answer'].includes(row.entityType) ? numeric(row.id) : row.entityType === 'feedReply' ? numeric(row.feedid || row.feedId || row.feed_id) : '';
      const replyId = row.entityType === 'feedReply' && feedId ? numeric(row.id) : '';
      const recommendationState = voteCommentRecommendation(row, isAdmin ? adminType : 0);
      const commentId = recommendationState?.commentId || '';
      const recommended = recommendationOverrides[commentId] ?? recommendationState?.recommended ?? false;
      return <article className="vote-discussion-row" data-vote-row-id={row.id || row.entityId || index} key={`${row.entityType || 'record'}:${row.id || row.entityId || index}`}>
        <Avatar src={row.userAvatar || row.userInfo?.userAvatar} name={name} size={34} /><div>{uid && onUser ? <button className="text-button" onClick={() => onUser(uid, name)}>{name}</button> : <strong>{name}</strong>}{row.dateline && <time>{relativeTime(row.dateline)}</time>}
          {typeof row.message === 'string' || typeof row.message_title === 'string' ? <RichText text={row.message || row.message_title} onLink={onLink || (() => {})} /> : <p className="muted">这条记录暂时没有可显示的正文。</p>}
          {feedId && onLink && <button className="text-button" onClick={() => onLink(`https://www.coolapk.com/feed/${feedId}${replyId ? '?rid=' + replyId : ''}`)}>{replyId ? '查看对应评论' : '查看动态'}</button>}
          {recommendationState && onRecommend && <button className="text-button" type="button" disabled={recommendationBusy} onClick={() => onRecommend(commentId, recommended ? 0 : 1, () => setRecommendationOverrides(old => ({ ...old, [commentId]: !recommended })))}>{recommended ? '下精选观点' : '精选观点'}</button>}
        </div>
      </article>;
    })}
    {rows.length > 0 && <LoadMore loading={resource.loading} error={resource.error} hasMore={resource.data?.hasMore} onClick={resource.more} />}
  </section>;
}
