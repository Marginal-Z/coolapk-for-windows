import { Heart, Images, MessageCircle } from 'lucide-react';
import { Avatar, EntityCard, FeedCard, Picture } from './components';
import { count, plain } from './data';
import { photoItems } from './photo-items';
import { useImageNetwork, useImagePreferences } from './image-preferences';
import { preferredImageSource } from '../core/image-preferences.mjs';
import { isFeedEntity } from './Community';
import type { Entity } from './types';
import './picture-posters.css';

export function PicturePosters({ items, onOpen, onUser, feedProps }: {
  items: Entity[]; onOpen: (item: Entity) => void; onUser: (uid: string, name: string) => void; feedProps: any;
}) {
  const { imagePreferences } = useImagePreferences(), network = useImageNetwork();
  return <div className="picture-posters" aria-label="酷图海报列表">{items.map((item, index) => {
    const photos = photoItems(item), key = `${item.entityType}:${item.id || index}`;
    if (!isFeedEntity(item)) return <EntityCard key={key} entity={item} onOpen={onOpen} onUser={onUser} onLink={feedProps.onLink} />;
    if (!photos.length) return <FeedCard key={key} feed={item} {...feedProps} />;
    const title = plain(item.message_title || item.message || '查看酷图'), author = plain(item.username || '酷友');
    return <article className="picture-poster" key={key} data-feed-id={item.id}>
      <button type="button" className="picture-poster-image" aria-label={`查看酷图：${title.slice(0, 80)}`} onClick={() => onOpen(item)}>
        <Picture src={preferredImageSource(photos[0], imagePreferences, false, network)} alt={title.slice(0, 120)} />
        {photos.length > 1 && <span className="picture-poster-count"><Images size={14} aria-hidden="true" />{photos.length}</span>}
        {photos[0].live && <span className="picture-poster-live">实况</span>}
      </button>
      <button type="button" className="picture-poster-title" onClick={() => onOpen(item)}>{title}</button>
      <footer><button type="button" className="picture-poster-author" onClick={() => onUser(String(item.uid || ''), author)}><Avatar src={item.userAvatar} name={author} size={24} /><span>{author}</span></button><button type="button" className="picture-poster-stats" aria-label={`查看动态，${count(item.likenum)} 赞，${count(item.replynum)} 评论`} onClick={() => onOpen(item)}><Heart size={13} aria-hidden="true" />{count(item.likenum)}<MessageCircle size={13} aria-hidden="true" />{count(item.replynum)}</button></footer>
    </article>;
  })}</div>;
}
