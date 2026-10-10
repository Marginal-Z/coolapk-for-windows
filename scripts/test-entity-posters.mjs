// Full production App with synthetic read-only IPC. No real account or network writes.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { DEFAULT_ACCOUNT_SETTINGS } from '../core/account-settings-models.mjs';

const directory = '.local/entity-posters', screenshots = `${directory}/screenshots`;
const port = Number(process.env.COOLAPK_ENTITY_POSTERS_TEST_PORT || 5277), origin = `http://127.0.0.1:${port}`;
const appVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
mkdirSync(screenshots, { recursive: true });
writeFileSync(`${directory}/fixture.html`, '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>');
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } });
await server.listen();
const checks = [], errors = [], measurements = [];
let browser, activePage;
const record = async (name, work) => { await work(); checks.push(name); console.log('PASS', name); };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1600, height: 980 }, reducedMotion: 'reduce', colorScheme: 'light' });
  const cover = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="420"><rect width="320" height="420" fill="#245a48"/><rect x="54" y="90" width="212" height="248" rx="24" fill="#9de5bd"/><circle cx="160" cy="170" r="45" fill="#e7f7ec"/></svg>';
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/')) return route.continue();
    if (url.startsWith('https://fixtures.invalid/entity-posters/')) return url.includes('/broken') ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'Synthetic missing cover' }) : route.fulfill({ contentType: 'image/svg+xml', body: cover });
    return route.abort();
  });
  await context.addInitScript(({ defaultSettings, appVersion }) => {
    localStorage.setItem('coolapk-preferences', JSON.stringify({ theme: 'light', materialEnabled: false }));
    const mock = window.__entityPosters = { reads: [], writes: [], rejected: [], external: [] };
    const account = { uid: '4242', username: '合成海报验收账号', userAvatar: '' };
    const ok = data => ({ ok: true, data }), list = (data, hasMore = false, cursor = '') => ok({ data, hasMore, firstItem: cursor && `${cursor}:first`, lastItem: cursor && `${cursor}:tail` });
    const image = index => index === 1 ? '' : `https://fixtures.invalid/entity-posters/${index === 2 ? 'broken' : 'cover'}-${index}.svg`;
    const topicRows = (category, page = 1) => Array.from({ length: page === 1 ? 9 : 3 }, (_, index) => ({ entityType: 'topic', id: `${category}-${page}-${index}`, title: `${category}话题 ${page}-${index}`, tag: `${category}话题 ${page}-${index}`, description: index === 3 ? '很长的话题说明'.repeat(15) : '合成话题介绍', logo: image(index), hot_num: 125000 + index, url: '/t/' + encodeURIComponent(`${category}话题 ${page}-${index}`) }));
    const apps = (mode, category, page = 1) => Array.from({ length: page === 1 ? 9 : 3 }, (_, index) => ({ entityType: 'apk', id: `${mode}-${category}-${page}-${index}`, packageName: `com.synthetic.${mode}.${category}.p${page}.n${index}`, title: `${mode === 'game' ? '游戏' : '应用'}海报 ${page}-${index}`, description: index === 3 ? '超长应用介绍'.repeat(18) : '合成应用说明', logo: image(index), rating: '8.5', downloadCount: 12500 + index }));
    const products = page => Array.from({ length: page === 1 ? 9 : 3 }, (_, index) => ({ entityType: 'product', id: String(800 + (page - 1) * 20 + index), title: `数码产品 ${page}-${index}`, description: index === 3 ? '超长产品名称与简介'.repeat(12) : '合成产品介绍', logo: image(index), price_min: '2999', rating_average_score: '8.9' }));
    const categoryRows = Array.from({ length: 8 }, (_, index) => ({ entityType: 'productCategory', id: String(20 + index), title: `数码分类 ${index}`, description: '按产品类型查找资料', logo: image(index), url: `#/product/productList?category_id=${20 + index}` }));
    const brandRows = Array.from({ length: 8 }, (_, index) => ({ entityType: 'productBrand', id: String(30 + index), title: `数码品牌 ${index}`, description: '浏览品牌旗下产品', logo: image(index), type: 'recommend' }));
    const models = Array.from({ length: 8 }, (_, index) => ({ entityType: 'ershouProduct', id: String(900 + index), title: `闲置型号 ${index}`, logo: image(index), ershou_num: 40 + index, ershouType: '100' }));
    const idlePrices = [
      { ershou_info: { product_price: '188', deal_type: 0, exchange_price_type: 0, is_face_deal: 0 } },
      { ershou_info: { product_price: '188', deal_type: 0, exchange_price_type: 0, is_face_deal: 1 } },
      { ershou_info: { product_price: '50', deal_type: 2, exchange_price_type: 1, is_face_deal: 0 } },
      { secondHandInfo: { product_price: '80', secondHandDealType: 2, exchangePriceType: 2, secondHandFaceDeal: 0 } },
      { ershou_info: { product_price: '288', deal_type: 1, exchange_price_type: 0, is_face_deal: 0 } },
      { ershou_info: { product_price: '188', deal_type: 0, exchange_price_type: 3, is_face_deal: 0 } },
    ];
    const feedRows = (prefix, page = 1) => Array.from({ length: page === 1 ? 8 : 3 }, (_, index) => ({ entityType: 'feed', feedType: 'ershou', id: String((prefix === 'home' ? 1100 : 1200) + (page - 1) * 20 + index), message_title: `${prefix === 'home' ? '首页闲置' : '筛选闲置'} ${page}-${index}`, message: `原始闲置正文 ${prefix} ${page}-${index}`, uid: '4343', username: '合成闲置作者', picArr: image(index) ? [image(index)] : [], ...idlePrices[index % idlePrices.length], dateline: 1, likenum: 20 + index }));
    const homeFeeds = feedRows('home');
    const init = [{ title: '首页', entities: [{ id: '66', title: '关注', url: 'V15_HOME_TAB_FOLLOW', page_visibility: '1' }] }];
    const topicCategories = ['热门', '摄影'].map(title => ({ entityType: 'verticalColumnsFullPage', title, url: `#/topic/tagList?keywords=${encodeURIComponent(title)}&sort=hot_num` }));
    window.coolapk = {
      accounts: async () => ok({ accounts: [account], current: account }), onAccount: () => () => {},
      onCommand: callback => { mock.command = callback; return () => {}; },
      teenager: async () => ok({ enabled: false, blocked: false, reason: null, usedMilliseconds: 0, remainingMilliseconds: 2400000, limitMilliseconds: 2400000, day: '2026-10-06', lockedUntil: null }), onTeenager: () => () => {},
      background: async () => ok({ available: false, revision: '', url: '', width: 0, height: 0, name: '', bytes: 0 }),
      updates: async () => ok({ currentVersion: appVersion, status: 'idle', distribution: 'installed' }), onUpdates: () => () => {},
      openExternal: async url => { mock.external.push(url); return ok({ opened: true }); },
      call: async (operation, args = {}) => {
        mock.reads.push({ operation, args: structuredClone(args) });
        const page = Number(args.page || 1);
        if (operation === 'init') return list(init);
        if (operation === 'accountSettings') return list({ values: { ...defaultSettings }, present: Object.keys(defaultSettings), guardExpiresAt: null, replyLocked: false });
        if (operation === 'notificationCount') return list({});
        if (['hotSearch', 'homeHotTopics', 'replies', 'hotReplies', 'advancedReplies', 'topicEntries', 'catalogProductFeeds'].includes(operation)) return list([]);
        if (operation === 'home') return list([{ entityType: 'feed', id: '100', uid: '4343', username: '合成酷友', message: '首页合成只读动态' }]);
        if (operation === 'page' && args.url === 'V11_VERTICAL_TOPIC') return ok({ data: [], surfaceItems: [{ entityType: 'card', entityTemplate: 'verticalColumnsFullPageCard', extraDataArr: { selectedTab: '热门' }, entities: topicCategories }], hasMore: false });
        if (operation === 'page' && topicCategories.some(item => item.url === args.url)) { const category = topicCategories.find(item => item.url === args.url).title; return list(topicRows(category, page), page === 1, `topic:${category}:${page}`); }
        if (operation === 'topicDetail') return list({ title: args.tag, tag: args.tag, description: '原话题详情介绍', follownum: 128 });
        if (operation === 'appDiscovery' || operation === 'gameDiscovery') { const mode = operation === 'gameDiscovery' ? 'game' : 'app'; return list(apps(mode, args.category, page), page === 1, `${mode}:${args.category}:${page}`); }
        if (operation === 'catalogApp') return list({ id: args.id, packageName: args.id, appName: `原应用详情 ${args.id}`, apkversionname: '1.2.3', developername: '合成开发者', description: '完整原应用介绍', logo: image(0) });
        if (operation === 'catalogProductCategories') return list(categoryRows);
        if (operation === 'catalogProductBrands') return list(brandRows);
        if (['catalogProductCategoryItems', 'catalogProductBrandItems', 'catalogMyProducts'].includes(operation)) return list(products(page), page === 1, `product:${page}`);
        if (operation === 'search' && args.type === 'product') return list(products(1).slice(0, 5));
        if (operation === 'catalogProduct') return list({ id: args.id, title: `原产品详情 ${args.id}`, description: '完整原产品介绍', configRows: [], tabList: [{ title: '讨论', url: `/product/feedList?id=${args.id}&type=feed` }] });
        if (operation === 'secondhandHome') return list([
          { entityType: 'selectorLink', id: 'idle-categories', title: '闲置分类组', entities: [{ entityType: 'mainErshouType', id: '100', title: '手机闲置', logo: image(0) }, { entityType: 'mainErshouType', id: '200', title: '相机闲置', logo: image(1) }, { entityType: 'selectorLink', id: '440300', title: '深圳闲置', cityId: '440300', cityTitle: '深圳', logo: image(2), url: '#/feed/ershouList?cityId=440300&dataListType=staggered' }] },
          { entityType: 'selectorLink', id: 'idle-models', title: '热门型号组', entities: [{ entityType: 'productGroupTitle', title: '原型号系列标题' }, ...models] },
          { entityType: 'selectorLink', id: 'idle-feeds', title: '酷友闲置组', entities: homeFeeds },
        ]);
        if (operation === 'secondhandBrands') return list([{ entityType: 'ershouBrand', id: '30', title: '闲置品牌甲', type: 'recommend' }, { entityType: 'ershouBrand', id: '31', title: '闲置品牌乙', type: 'recent' }]);
        if (operation === 'secondhandProducts') return list(models);
        if (operation === 'secondhandListings' || operation === 'secondhandSearch') return ok({ data: feedRows('list', page), hasMore: operation === 'secondhandListings' && page === 1, firstItem: 'idle:first', lastItem: `idle:tail:${page}`, pageContext: `idle:context:${page}` });
        if (operation === 'detail') { const value = [...homeFeeds, ...feedRows('list'), ...feedRows('list', 2)].find(item => item.id === String(args.id)); if (value) return list(value); }
        mock.rejected.push({ operation, args });
        if (operation === 'action' || /Wish|Follow|Favorite|Rating$|Comment$|Create|Update|Delete|Edit|Publish|Upload|Close/.test(operation)) mock.writes.push({ operation, args });
        return { ok: false, error: { code: 'TEST_BLOCKED', message: '海报隔离验收未声明操作：' + operation } };
      },
    };
  }, { defaultSettings: DEFAULT_ACCOUNT_SETTINGS, appVersion });
  const page = activePage = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.goto(`${origin}/${directory}/fixture.html`);
  await page.locator('.account-entry strong').getByText('合成海报验收账号', { exact: true }).waitFor();
  await page.locator('.main-scroll[data-page-kind="home"]').getByText('首页合成只读动态', { exact: true }).waitFor();
  const main = () => page.locator('.main-scroll');
  const navigate = async title => { await page.getByRole('group', { name: '社区导航', exact: true }).getByRole('button', { name: title, exact: true }).click(); await main().locator('.entity-poster').first().waitFor(); };
  const poster = id => main().locator(`.entity-poster[data-entity-id="${id}"]`);
  const reads = operation => page.evaluate(operation => window.__entityPosters.reads.filter(item => item.operation === operation), operation);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function setTheme(theme) {
    const current = await page.evaluate(() => document.documentElement.dataset.theme);
    if (current !== theme) await page.getByRole('button', { name: theme === 'dark' ? '切换深色主题' : '切换浅色主题', exact: true }).click();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
  }
  async function layout(name, gridSelector) {
    for (const theme of ['light', 'dark']) for (const width of [1600, 900]) {
      await page.setViewportSize({ width, height: 980 }); await setTheme(theme); await settle();
      const result = await main().locator(gridSelector).first().evaluate(grid => {
        const scroll = document.querySelector('.main-scroll'), cards = [...grid.querySelectorAll('.entity-poster')], box = scroll.getBoundingClientRect();
        return { width: innerWidth, theme: document.documentElement.dataset.theme, documentWidth: document.documentElement.scrollWidth, scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth, columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, posterCount: cards.length, posterBounds: cards.slice(0, 8).map(card => { const rect = card.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, inside: rect.left >= box.left - 1 && rect.right <= box.right + 1 }; }), textColor: getComputedStyle(cards[0]).color, background: getComputedStyle(cards[0]).backgroundColor };
      });
      measurements.push({ page: name, ...result });
      assert.ok(result.columns >= 2, `${name} needs multiple columns at ${width}px (${theme})`);
      assert.ok(result.documentWidth <= width && result.scrollWidth <= result.clientWidth + 1, `${name} horizontally overflows at ${width}px (${theme})`);
      assert.ok(result.posterBounds.every(bounds => bounds.inside && bounds.width > 100 && bounds.height > bounds.width), `${name} posters must retain vertical covers within the scroll area`);
      assert.ok(result.posterBounds[0].x < result.posterBounds[1].x && Math.abs(result.posterBounds[0].y - result.posterBounds[1].y) < 2, `${name} first row is not a poster grid`);
      await main().evaluate(node => node.scrollTop = 0); await settle();
      await page.screenshot({ path: `${screenshots}/${name}-${width}-${theme}.png` });
    }
    await page.setViewportSize({ width: 1600, height: 980 }); await setTheme('light');
  }
  async function imageFallbacks(goodId, noImageId, brokenId) {
    await poster(goodId).locator('img').first().waitFor();
    await page.waitForFunction(id => { const image = document.querySelector(`.main-scroll .entity-poster[data-entity-id="${id}"] img`); return image && image.complete && image.naturalWidth > 0; }, goodId);
    await poster(noImageId).locator('.entity-poster-placeholder').waitFor();
    await poster(brokenId).locator('.entity-poster-placeholder').waitFor();
    assert.ok(await poster(noImageId).locator('.entity-poster-title').innerText());
    assert.equal(await poster(noImageId).locator('.entity-poster-open').isEnabled(), true);
    assert.equal(await poster(brokenId).locator('.entity-poster-open').isEnabled(), true);
  }
  async function automaticPage(operation, expectedArgs, finalId) {
    await main().evaluate(node => node.scrollTop = node.scrollHeight);
    const box = await main().boundingBox(); assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(180, box.height / 2));
    await page.mouse.wheel(0, 1000); await poster(finalId).waitFor();
    const pages = (await reads(operation)).filter(item => item.args.page === 2);
    assert.equal(pages.length, 1); assert.deepEqual(pages[0].args, expectedArgs);
    await main().evaluate(node => node.scrollTop = node.scrollHeight); await page.mouse.wheel(0, 1000); await settle();
    assert.equal((await reads(operation)).filter(item => item.args.page === 2).length, 1);
    assert.equal(await main().getByRole('button', { name: '已经看完了', exact: true }).isDisabled(), true);
    await main().evaluate(node => node.scrollTop = 0);
  }

  await record('topic square uses vertical posters, readable fallback covers and light/dark multiple-column layouts', async () => {
    await navigate('话题广场'); await poster('热门-1-0').waitFor();
    await imageFallbacks('热门-1-0', '热门-1-1', '热门-1-2');
    assert.equal(await main().locator('.entity-poster[data-variant="topic"]').count(), 9);
    await layout('topics', '.topic-discovery-grid');
  });
  await record('topic categories and posters preserve the original detail and automatic paging arguments', async () => {
    await main().getByRole('tab', { name: '摄影', exact: true }).click(); await poster('摄影-1-0').waitFor();
    await automaticPage('page', { url: '#/topic/tagList?keywords=' + encodeURIComponent('摄影') + '&sort=hot_num', page: 2, firstItem: 'topic:摄影:1:first', lastItem: 'topic:摄影:1:tail' }, '摄影-2-0');
    await poster('摄影-1-0').locator('.entity-poster-open').click();
    await main().locator('.community-header').getByText('原话题详情介绍', { exact: true }).waitFor();
    assert.equal((await reads('topicDetail')).at(-1).args.tag, '摄影话题 1-0');
    await page.getByRole('button', { name: '返回', exact: true }).click(); await poster('热门-1-0').waitFor();
  });
  await record('apps and games both keep discovery filters, fallback posters and original application details', async () => {
    await navigate('应用与游戏'); await poster('app-recommend-1-0').waitFor();
    await imageFallbacks('app-recommend-1-0', 'app-recommend-1-1', 'app-recommend-1-2');
    await layout('apps', '.app-discovery-grid');
    await main().getByRole('combobox', { name: '应用分类', exact: true }).selectOption('tools'); await poster('app-tools-1-0').waitFor();
    assert.deepEqual((await reads('appDiscovery')).at(-1).args, { category: 'tools', page: 1 });
    await main().getByRole('button', { name: '游戏', exact: true }).click(); await poster('game-hot-1-0').waitFor();
    await main().getByRole('combobox', { name: '游戏分类', exact: true }).selectOption('indie'); await poster('game-indie-1-0').waitFor();
    assert.deepEqual((await reads('gameDiscovery')).at(-1).args, { category: 'indie', page: 1 });
    await poster('game-indie-1-0').locator('.entity-poster-open').click();
    await main().getByRole('heading', { name: '原应用详情 com.synthetic.game.indie.p1.n0', exact: true }).waitFor();
    assert.deepEqual((await reads('catalogApp')).at(-1).args, { id: 'com.synthetic.game.indie.p1.n0' });
    await page.getByRole('button', { name: '返回', exact: true }).click(); await poster('app-recommend-1-0').waitFor();
    await automaticPage('appDiscovery', { category: 'recommend', page: 2, firstItem: 'app:recommend:1:first', lastItem: 'app:recommend:1:tail' }, 'app-recommend-2-0');
  });
  await record('digital categories, brands and products render posters with local filters and original product routing', async () => {
    await navigate('数码'); await poster('20').waitFor(); await imageFallbacks('20', '21', '22');
    await layout('digital', '.catalog-poster-grid');
    await poster('20').locator('.entity-poster-open').click(); await poster('800').waitFor();
    assert.equal((await reads('catalogProductCategoryItems')).at(-1).args.url, '#/product/productList?category_id=20');
    await imageFallbacks('800', '801', '802');
    assert.equal(await poster('800').locator('.entity-poster-meta').innerText(), '8.9 分');
    await poster('800').locator('.entity-poster-open').click(); await main().getByRole('heading', { name: '原产品详情 800', exact: true }).waitFor();
    assert.deepEqual((await reads('catalogProduct')).at(-1).args, { id: '800' });
    await page.getByRole('button', { name: '返回', exact: true }).click(); await poster('20').waitFor();
    await main().getByRole('tab', { name: '品牌', exact: true }).click(); await poster('30').waitFor();
    assert.equal(await poster('30').getAttribute('data-variant'), 'brand');
    await poster('30').locator('.entity-poster-open').click(); await poster('800').waitFor();
    const brandArgs = (await reads('catalogProductBrandItems')).at(-1).args; assert.equal(brandArgs.id, '30'); assert.equal(brandArgs.type, 'recommend');
    await main().getByRole('textbox', { name: '搜索资料库', exact: true }).fill('海报测试手机');
    await main().locator('.catalog-search').getByRole('button', { name: '搜索', exact: true }).click(); await poster('804').waitFor();
    assert.deepEqual((await reads('search')).at(-1).args, { query: '海报测试手机', type: 'product' });
    assert.equal(await main().locator('.entity-poster').count(), 5);
  });
  await record('discovery hub is a poster grid and its digital library entry retains the existing catalog route', async () => {
    await navigate('发现更多'); await poster('products').waitFor(); await layout('discover', '.catalog-hub');
    assert.equal(await main().locator('.entity-poster[data-variant="category"]').count(), 6);
    await poster('products').locator('.entity-poster-open').click(); await poster('20').waitFor();
    await main().getByRole('tab', { name: '分类', exact: true }).waitFor();
    assert.equal(await main().getAttribute('data-page-kind'), 'catalog');
  });
  await record('secondhand keeps nested headers, fallback covers, sale/negotiable/exchange prices and original feed details', async () => {
    await navigate('二手'); await poster('1100').waitFor();
    for (const title of ['闲置分类组', '热门型号组', '原型号系列标题', '酷友闲置组']) await main().getByRole('heading', { name: title, exact: true }).waitFor();
    await imageFallbacks('1100', '1101', '1102');
    for (const [id, expected] of [['1100', '¥188'], ['1101', '价格面议'], ['1102', '卖家加钱 ¥50'], ['1103', '买家加钱 ¥80'], ['1104', '收购 ¥288'], ['1105', '价格面议']]) {
      assert.equal(await poster(id).locator('.entity-poster-meta').innerText(), expected);
    }
    for (const id of ['1101', '1105']) assert.equal(await poster(id).locator('.entity-poster-meta').getByText(/¥/).count(), 0, 'Negotiable price must not display an ordinary sale amount');
    await layout('secondhand', '.secondhand-results');
    assert.equal(await poster('1100').locator('.entity-poster-author').count(), 1);
    await poster('1100').locator('.entity-poster-open').click();
    const dialog = page.getByRole('dialog', { name: '动态详情', exact: true });
    await dialog.getByText('原始闲置正文 home 1-0', { exact: true }).waitFor();
    assert.deepEqual((await reads('detail')).at(-1).args, { id: '1100' });
    await page.getByRole('button', { name: '关闭动态详情', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  });
  await record('secondhand model picker preserves city/model filters, searches and original pagination context', async () => {
    await poster('100').locator('.entity-poster-open').click(); await poster('1200').waitFor();
    assert.equal((await reads('secondhandListings')).at(-1).args.filters.ershouType, '100');
    await main().getByRole('combobox', { name: '闲置城市', exact: true }).selectOption('440300'); await main().getByRole('button', { name: '应用筛选', exact: true }).click(); await poster('1200').waitFor();
    await main().getByRole('button', { name: '品牌与型号', exact: true }).click();
    const picker = page.getByRole('dialog', { name: '选择闲置品牌与型号', exact: true }); await picker.getByRole('button', { name: '闲置品牌乙', exact: true }).click();
    await picker.locator('.entity-poster[data-entity-id="900"] .entity-poster-open').click(); await picker.waitFor({ state: 'hidden' }); await poster('1200').waitFor();
    const initial = (await reads('secondhandListings')).at(-1).args;
    assert.equal(initial.filters.brand, '31'); assert.equal(initial.filters.productId, '900'); assert.equal(initial.filters.cityId, '440300');
    assert.ok((await reads('secondhandProducts')).some(item => item.args.brandId === '31' && item.args.listType === 'recent'));
    await automaticPage('secondhandListings', { ...initial, page: 2, firstItem: 'idle:first', lastItem: 'idle:tail:1', pageContext: 'idle:context:1' }, '1220');
    await main().getByRole('textbox', { name: '搜索闲置', exact: true }).fill('合成手机'); await main().getByRole('button', { name: '搜索闲置', exact: true }).click(); await poster('1200').waitFor();
    assert.deepEqual((await reads('secondhandSearch')).at(-1).args, { keyword: '合成手机', productId: '900', ershouType: '100' });
    assert.equal(await main().getByRole('combobox', { name: '闲置城市', exact: true }).isDisabled(), true);
  });
  await record('all poster validation stays within declared synthetic reads without real writes or renderer exceptions', async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => window.__entityPosters.rejected), []);
    assert.deepEqual(await page.evaluate(() => window.__entityPosters.writes), []);
    assert.deepEqual(await page.evaluate(() => window.__entityPosters.external), []);
    for (const name of ['topics', 'apps', 'digital', 'discover', 'secondhand']) {
      const colors = measurements.filter(item => item.page === name && item.width === 1600);
      assert.equal(colors.length, 2); assert.notEqual(colors[0].textColor, colors[1].textColor);
    }
  });
  writeFileSync('research/entity-posters-ui-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'full production App; synthetic isolated read-only bridge; external network blocked; no real account or cloud writes; does not certify every live-data shape', checks, measurements, errors, realCloudWrites: 0, result: 'passed' }, null, 2) + '\n');
  console.log('ENTITY_POSTERS_PASS', checks.length); await context.close();
} catch (error) {
  if (activePage && !activePage.isClosed()) { await activePage.screenshot({ path: `${screenshots}/failure.png` }); console.error('ENTITY_POSTERS_FAILURE', JSON.stringify({ errors, state: await activePage.locator('body').innerText(), bridge: await activePage.evaluate(() => window.__entityPosters) })); }
  throw error;
} finally { await browser?.close(); await server.close(); }
