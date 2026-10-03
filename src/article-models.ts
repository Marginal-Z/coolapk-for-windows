import type { Entity } from './types';

export const articleMetadataTypes = new Set(['top', 'bottom', 'relativeInfo']);
export const articlePreservedTypes = new Set(['card', 'shareUrl', 'else']);
export function readArticleModels(message: any): Entity[] | null {
  try {
    const models = typeof message === 'string' ? JSON.parse(message) : message;
    return Array.isArray(models) ? models : null;
  } catch { return null; }
}
export function articleModelSupported(model: any) {
  return !!model && typeof model === 'object' && !Array.isArray(model) &&
    (model.type === 'text' && typeof model.message === 'string' || model.type === 'image' && typeof model.url === 'string' || articlePreservedTypes.has(model.type) || articleMetadataTypes.has(model.type));
}
export function articleDraft(feed: Entity) {
  const source = readArticleModels(feed.message);
  const top = source?.find(model => model?.type === 'top');
  return {
    models: source?.filter(model => !articleMetadataTypes.has(model?.type)) || [],
    title: String(feed.message_title || feed.messageTitle || top?.description || ''),
    cover: String(feed.message_cover || feed.messageCover || top?.url || ''),
    supported: !!source && source.length <= 300 && source.every(articleModelSupported) && source.filter(model => model?.type === 'top').length <= 1,
  };
}
