// Preserve the server's card groups instead of reducing the homepage to feeds.
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function surfaceItemKey(item) {
  if (!object(item)) return '';
  const id = item.entityId ?? item.id;
  if (id != null && String(id)) return `${item.entityType || ''}:${item.entityType === 'card' ? item.entityTemplate || '' : ''}:${id}`;
  return JSON.stringify([item.entityType, item.entityTemplate, item.title, item.url, item.pic, item.message, item.uid, item.dateline]);
}
export function mergeSurfaceItems(previous, next, depth = 0) {
  if (!Array.isArray(previous) && !Array.isArray(next)) return undefined;
  const rows = (Array.isArray(previous) ? previous : []).filter(object).slice();
  const positions = new Map(rows.map((item, index) => [surfaceItemKey(item), index]));
  for (const item of Array.isArray(next) ? next : []) {
    if (!object(item)) continue;
    const key = surfaceItemKey(item), index = positions.get(key);
    if (index === undefined) { positions.set(key, rows.length); rows.push(item); }
    else if (depth < 8 && Array.isArray(item.entities) && ![true, 1, '1'].includes(rows[index].entityFixed)) {
      rows[index] = { ...rows[index], entities: mergeSurfaceItems(rows[index].entities, item.entities, depth + 1) };
    }
  }
  return rows;
}
export function surfaceLeafCount(rows, depth = 0) {
  if (!Array.isArray(rows) || depth > 8) return 0;
  return rows.reduce((count, item) => count + (!object(item) ? 0 : Array.isArray(item.entities) && item.entities.length ? surfaceLeafCount(item.entities, depth + 1) : 1), 0);
}
export function homeHeaderItems(rows) {
  return Array.isArray(rows) ? rows.filter(item => object(item) && ['imageCarouselCard_1', 'iconLinkGridCard', 'iconMiniScrollCard'].includes(item.entityTemplate)) : [];
}
export function homeSurfaceSections(rows, { visibleFeed = () => true } = {}, depth = 0, seen = new Set()) {
  if (!Array.isArray(rows) || depth > 8) return [];
  const sections = [];
  for (const item of rows) {
    if (!object(item) || seen.has(item) || item.entityType === 'ad' || item.entityTemplate === 'configCard' || /^sponsor(?:$|[_A-Z])/i.test(item.entityTemplate || '')) continue;
    seen.add(item);
    if (item.entityType === 'feed' && !visibleFeed(item)) continue;
    if (item.entityType === 'card' && Array.isArray(item.entities) && item.entities.length) {
      const children = homeSurfaceSections(item.entities, { visibleFeed }, depth + 1, seen);
      if (children.length) sections.push({ item, children });
    } else if (item.entityType !== 'card' || item.title || item.description || item.url || item.pic) sections.push({ item });
  }
  return sections;
}
