import { secureUrl } from './data';
import type { Entity } from './types';

export type PhotoItem = { source: string; cover: string; live: boolean; video?: string };
const first = (value: Entity, fields: string[]) => fields.map(field => value[field]).find(item => typeof item === 'string' && item.trim()) || '';
const enabled = (value: unknown) => [true, 1, '1', 'true', 'yes'].includes(value as any);
export const isLivePhotoSource = (value: string) => /https?:\/\/\S+livepic\S*@\d+x\d+\.(?:jpg|jpeg|png|gif|webp)(?:[?#].*)?$/i.test(value);
function imageUrl(value: string) {
  if (!value) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:/i.test(value)) return '';
  if (value.startsWith('//')) return secureUrl('https:' + value);
  return secureUrl(/^https?:/i.test(value) ? value : 'https://image.coolapk.com/' + value.replace(/^\/+/, ''));
}
function flatten(value: any, depth = 0): any[] {
  if (!value || depth > 5) return [];
  if (Array.isArray(value)) return value.flatMap(item => flatten(item, depth + 1));
  if (typeof value === 'string') {
    if (/^\s*[\[{]/.test(value) && value.length < 200000) { try { return flatten(JSON.parse(value), depth + 1); } catch {} }
    return value.split(',').map(url => url.trim()).filter(Boolean);
  }
  if (typeof value !== 'object') return [];
  const own = first(value, ['sourceUrl', 'source_url', 'inSource', 'in_source', 'url', 'pic', 'imageUrl', 'image_url', 'src']);
  const nested = value.imageUriList || value.image_uri_list || value.items;
  return own || !nested ? [value] : flatten(nested, depth + 1);
}
export function photoItem(input: any): PhotoItem | null {
  const record = typeof input === 'object' && input ? input : {};
  const source = imageUrl(typeof input === 'string' ? input : first(record, ['sourceUrl', 'source_url', 'inSource', 'in_source', 'url', 'pic', 'imageUrl', 'image_url', 'src']));
  const cover = imageUrl(first(record, ['compressedUrl', 'compressed_url', 'coverUrl', 'cover_url', 'thumbnail', 'thumb', 'smallUrl', 'small_url'])) || source;
  if (!source && !cover) return null;
  const video = secureUrl(first(record, ['liveVideoUrl', 'live_video_url']));
  return { source: source || cover, cover, video, live: !!video || isLivePhotoSource(source) || isLivePhotoSource(cover) || ['livePhotoEnable', 'live_photo_enable', 'isLivePhoto', 'is_live_photo'].some(field => enabled(record[field])) };
}
export function photoItems(entity: Entity): PhotoItem[] {
  for (const candidate of [entity.imageUriList, entity.image_uri_list, entity.pics, entity.picArr, entity.pic, entity.message_cover || entity.messageCover]) {
    const items = flatten(candidate).map(photoItem).filter((item): item is PhotoItem => !!item);
    if (items.length) return items;
  }
  return [];
}
