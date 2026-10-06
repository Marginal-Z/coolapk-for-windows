import { useState } from 'react';
import { AppWindow, Camera, Grid3X3, Hash, Headphones, Images, Monitor, ShoppingBag, Smartphone, Tablet, Watch } from 'lucide-react';
import { Avatar } from './components';
import { count, imageUrl, plain, secureUrl } from './data';
import { photoItems } from './photo-items';
import { useImageNetwork, useImagePreferences } from './image-preferences';
import { preferredImageSource } from '../core/image-preferences.mjs';
import { appIconSource, appScreenshots } from '../core/app-media.mjs';
import { secondhandPosterPrice } from '../core/secondhand-poster.mjs';
import type { Entity } from './types';
import './entity-posters.css';

export type PosterVariant = 'topic' | 'app' | 'product' | 'category' | 'brand' | 'secondhand';
type Props = { entity: Entity; onOpen: (entity: Entity) => void; variant: PosterVariant; onUser?: (uid: string, name: string) => void };
const firstText = (...values: unknown[]) => values.find(value => typeof value === 'string' && value.trim() || typeof value === 'number') ?? '';

function fallbackIcon(variant: PosterVariant, title: string) {
  if (variant === 'topic') return Hash;
  if (variant === 'app') return AppWindow;
  if (/耳机|音频/.test(title)) return Headphones;
  if (/平板/.test(title)) return Tablet;
  if (/手表|穿戴/.test(title)) return Watch;
  if (/相机|摄影/.test(title)) return Camera;
  if (/电脑|笔记本|显示器/.test(title)) return Monitor;
  if (variant === 'product' || /手机|数码/.test(title)) return Smartphone;
  return variant === 'secondhand' ? ShoppingBag : Grid3X3;
}

function metadata(entity: Entity, variant: PosterVariant) {
  if (variant === 'topic') {
    const heat = plain(entity.hot_num_txt) || (entity.hot_num != null ? count(entity.hot_num) : '');
    return heat ? `热度 ${heat}` : '';
  }
  if (variant === 'app' || variant === 'product') {
    const rating = variant === 'product' ? firstText(entity.rating_average_score, entity.rating, entity.score) : firstText(entity.rating, entity.score);
    return rating !== '' ? `${plain(rating)} 分` : '';
  }
  if (variant === 'secondhand') {
    const price = secondhandPosterPrice(entity);
    if (price) return price;
    const quantity = firstText(entity.ershou_num, entity.ershouNum, entity.productNum, entity.product_num);
    if (quantity !== '') return `${plain(quantity)} 件闲置`;
  }
  return entity.commentnum != null ? `${count(entity.commentnum)} 条讨论` : '';
}

export function EntityPoster({ entity, onOpen, variant, onUser }: Props) {
  const title = plain(firstText(entity.message_title, entity.title, entity.appName, entity.name, entity.product_name, entity.tag, entity.message, '查看内容'));
  const description = plain(firstText(entity.description, entity.shortDescription, entity.intro, entity.subTitle, entity.subtitle, entity.message));
  const { imagePreferences } = useImagePreferences(), network = useImageNetwork();
  const photos = variant === 'secondhand' ? photoItems(entity) : [];
  const screenshot = variant === 'app' ? appScreenshots(entity)[0] : '';
  const source = photos.length ? preferredImageSource(photos[0], imagePreferences, false, network)
    : screenshot || (variant === 'app' ? appIconSource(entity) : '') || secureUrl(firstText(entity.cover, entity.pic, entity.logo, entity.icon, entity.product_logo));
  const iconOnly = variant === 'app' && !screenshot;
  const [failedSource, setFailedSource] = useState('');
  const Icon = fallbackIcon(variant, title), info = metadata(entity, variant);
  const author = plain(firstText(entity.username, entity.userInfo?.username));
  const uid = String(entity.uid ?? entity.userInfo?.uid ?? '');
  const showAuthor = variant === 'secondhand' && !!onUser && !!author && !!uid;
  return <article className="entity-poster" data-variant={variant} data-entity-id={String(entity.id ?? entity.entityId ?? entity.packageName ?? '')}>
    <button type="button" className="entity-poster-open" onClick={() => onOpen(entity)}>
      <span className={`entity-poster-cover${iconOnly ? ' entity-poster-cover-icon' : ''}`}>
        {source && source !== failedSource ? <img key={source} src={imageUrl(source)} alt="" loading="lazy" decoding="async" onError={() => setFailedSource(source)} />
          : <span className="entity-poster-placeholder" aria-hidden="true"><Icon size={48} strokeWidth={1.5} /></span>}
        {photos.length > 1 && <span className="entity-poster-image-count"><Images size={13} aria-hidden="true" />{photos.length}</span>}
      </span>
      <span className="entity-poster-copy"><strong className="entity-poster-title">{title}</strong>
        {description && description !== title && <span className="entity-poster-description">{description}</span>}
        {info && <span className={`entity-poster-meta${info.startsWith('¥') ? ' entity-poster-price' : ''}`}>{info}</span>}
      </span>
    </button>
    {showAuthor && <button type="button" className="entity-poster-author" onClick={() => onUser(uid, author)}><Avatar src={entity.userAvatar || entity.userInfo?.userAvatar} name={author} size={22} /><span>{author}</span></button>}
  </article>;
}
