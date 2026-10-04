import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoolapkClient } from '../core/client.mjs';
import { dispatchHome } from '../core/home.mjs';
import { homeHeaderItems, homeSurfaceSections, mergeSurfaceItems, surfaceItemKey, surfaceLeafCount } from '../core/home-surface.mjs';
const feed = id => ({ entityType: 'feed', id, entityId: id, message: `feed ${id}` });
const card = (template, entities, id = template) => ({ entityType: 'card', entityId: id, entityTemplate: template, entities });
test('home and page dispatch retain complete card structure alongside backwards compatible flat rows', async () => {
  const rows = [card('imageCarouselCard_1', [{ entityType: 'image_1', title: '活动', url: '/t/活动', pic: 'https://image.coolapk.com/banner.png' }]), card('iconLinkGridCard', Array.from({ length: 10 }, (_, i) => ({ entityType: 'iconLink', title: `入口${i}`, url: `/t/入口${i}` }))), feed(1)];
  const client = new CoolapkClient(); client.request = async () => ({ data: rows, hasMore: true });
  for (const operation of ['home', 'page']) { const result = await client.dispatch(operation, operation === 'page' ? { url: 'V11_HOME_CAR' } : {}); assert.equal(result.surfaceItems, rows); assert.equal(result.data.length, 12); }
  const headline = await dispatchHome(client, 'homeHeadline'); assert.equal(headline.surfaceItems, rows);
});
test('all fixed navigation and banner cards survive while feed block rules cover nested groups', () => {
  const rows = [card('imageCarouselCard_1', [{ title: 'banner', entityType: 'image_1' }]), card('iconLinkGridCard', [{ title: 'link', entityType: 'iconLink' }]), card('iconMiniScrollCard', [{ title: 'topic', entityType: 'topic' }]), card('imageTextScrollCard', [feed(1), feed(2)]), feed(3)];
  assert.equal(homeHeaderItems(rows).length, 3);
  const sections = homeSurfaceSections(rows, { visibleFeed: item => item.id !== 2 });
  assert.equal(sections.length, 5); assert.deepEqual(sections[3].children.map(x => x.item.id), [1]);
});
test('pagination preserves fixed initial cards and recursively merges newly returned group entries', () => {
  const first = [{ ...card('iconLinkGridCard', [{ title: 'first', entityType: 'iconLink' }]), entityFixed: 1 }, card('imageTextScrollCard', [feed(1)]), feed(2)];
  const next = [{ ...card('iconLinkGridCard', [{ title: 'replacement', entityType: 'iconLink' }]), entityFixed: 1 }, card('imageTextScrollCard', [feed(1), feed(3)]), feed(2), feed(4)];
  const merged = mergeSurfaceItems(first, next); assert.equal(merged.length, 4); assert.equal(merged[0], first[0]); assert.equal(merged[1].entities.length, 2); assert.equal(surfaceLeafCount(merged), 5); assert.equal(surfaceLeafCount(first), 3);
});
test('idless entries are independently keyed and malformed or cyclic structures are bounded', () => {
  const rows = [{ entityType: 'iconLink', url: '/t/A', title: 'A' }, { entityType: 'iconLink', url: '/t/B', title: 'B' }];
  assert.notEqual(surfaceItemKey(rows[0]), surfaceItemKey(rows[1])); assert.equal(mergeSurfaceItems(rows, rows).length, 2); assert.equal(mergeSurfaceItems(undefined, undefined), undefined);
  const cycle = card('unknown', []); cycle.entities.push(cycle); assert.equal(homeSurfaceSections([null, 1, cycle]).length, 0); assert.equal(surfaceLeafCount([cycle]), 0);
  assert.deepEqual(homeSurfaceSections([{ entityType: 'card', entityTemplate: 'configCard', title: 'metadata' }, { entityType: 'card', entityTemplate: 'sponsorCard', title: 'sponsor' }, { entityType: 'ad', title: 'ad' }]), []);
});
test('unknown groups and non-feed entities remain visible rather than silently discarded', () => {
  const sections = homeSurfaceSections([card('futureLayout', [{ entityType: 'apk', id: 'app', title: 'app' }, { entityType: 'product', id: 'phone', title: 'phone' }]), { entityType: 'futureType', title: 'future', url: '/page?url=V1_FUTURE' }]);
  assert.equal(sections.length, 2); assert.equal(sections[0].children.length, 2); assert.equal(sections[1].item.title, 'future');
});
