import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const port = Number(process.env.COOLAPK_CATALOG_TEST_PORT || 5176), origin = `http://127.0.0.1:${port}`;
const output = resolve('.local/catalog-check'); mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'test.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
writeFileSync(resolve(output, 'entry.tsx'), `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import Catalog from '/src/Catalog.tsx';import'/src/styles.css';function Fixture(){const[page,setPage]=useState({kind:'catalog',type:'hub',title:'发现'});const[uid,setUid]=useState('123456');window.__catalogNavigate=(type,id,title)=>setPage({kind:'catalog',type,id,title:title||'界面测试'});window.__catalogAccount=(value)=>{window.__catalogMock.uid=value;setUid(value)};const account=uid?{uid,username:'模拟酷友',userAvatar:''}:null;const noop=()=>{};return <main style={{maxWidth:1000,margin:'auto',padding:30}}><Catalog page={page} namespace={uid||'guest'} account={account} go={setPage} onLogin={()=>window.__catalogMock.login++} openEntity={item=>window.__catalogMock.opened.push(item)} toast={noop} feedProps={{onOpen:noop,onUser:noop,onLink:noop,onLogin:noop,onForward:noop,loggedIn:!!account,accountUid:uid,toast:noop}}/></main>}createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
writeFileSync(resolve(output, 'entry.tsx'), readFileSync(resolve(output, 'entry.tsx'), 'utf8').replace('onOpen:noop', 'onOpen:item=>window.__catalogMock.opened.push(item)').replace('<main style=', '<main data-account={uid} data-product={page.id} style='));
let browser; const checks = [], productChecks = [], errors = [];
async function record(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }
async function productRecord(name, fn) { await record(name, fn); productChecks.push(name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  let syntheticVideo;
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : syntheticVideo && route.request().url() === 'https://video.coolapk.com/video/synthetic-product.webm' ? route.fulfill({ status: 200, contentType: 'video/webm', body: syntheticVideo }) : route.abort());
  await context.addInitScript(() => {
    const mock = window.__catalogMock = { calls: [], opened: [], login: 0, uid: '123456', pending: [], verifications: [], holdVerification: false, failSubtabMore: '', failRatingMore: '', holdRatingUrl: '', missingOwnerStats: false, holdProductMedia: '', holdFeedSort: '', failCommentsMore: '', holdCommentSort: '', uploadMode: '', uploadCount: 0, delayRatingsStar: -1, emptyProductTabs: false, badVersions: false, album: { id: 7, uid: '123456', title: '工具箱', intro: '常用工具', cover: 'https://image.coolapk.com/album/original.png', apkList: [{ entityType: 'apk', packageName: 'com.example.one', title: '应用甲' }] }, failOnce: '' };
    const ok = data => ({ ok: true, data }), list = data => ({ data, hasMore: false });
    window.coolapk = { openExternal: async () => ok({}), verify: async id => { mock.verifications.push(id); if (mock.holdVerification) return new Promise(resolve => mock.pending.push({ operation: 'verify', resolve: () => resolve(ok({})) })); return ok({}); }, call: async (operation, args = {}) => {
      mock.calls.push({ operation, args: JSON.parse(JSON.stringify(operation === 'uploadImage' ? { ...args, bytes: Array.from(args.bytes) } : args)), uid: mock.uid });
      if (operation === mock.failOnce) { mock.failOnce = ''; return { ok: false, error: { code: 'NETWORK', message: '模拟网络失败' } }; }
      if (operation === 'catalogProductSubtab' && args.page === 2 && mock.failSubtabMore) { const code = mock.failSubtabMore; mock.failSubtabMore = ''; return { ok: false, error: { code, message: code === 'VERIFY_REQUIRED' ? '模拟第二页验证' : '模拟第二页网络失败', ...(code === 'VERIFY_REQUIRED' ? { verificationId: 'catalog-page2' } : {}) } }; }
      if (operation === 'search') return ok(list([{ entityType: 'product', id: 8, title: '另一款手机' }]));
      if (operation === 'catalogProduct') {
        const tab = (title, type, extra = '') => ({ title, url: '/page?url=' + encodeURIComponent(`/product/feedList?id=${args.id}&type=${type}${extra}`) });
        const tabList = mock.emptyProductTabs ? [] : [tab('讨论', 'feed'), { ...tab('样张板块', 'subTabFeed', '&subId=004'), page_name: '004' }, { ...tab('隐藏栏目', 'video'), is_open: '0' }, tab('点评栏目', 'rating'), tab('图文栏目', 'article'), { title: '鸿蒙栏目', page_name: 'diy9', url: '/topic/tagList?keywords=鸿蒙' }, { title: '异机栏目', url: '/product/feedList?id=999&type=feed' }, { title: '外站栏目', url: 'https://evil.test/product/feedList?id=' + args.id + '&type=feed' }, { title: '写入栏目', url: '/feed/deleteFeed?id=123' }, tab('重复讨论', 'feed')];
        return ok({ data: { id: args.id, title: args.id === '8' ? '另一款手机' : '测试手机', logo: '', configRows: [{ id: args.id === '8' ? 91 : 71, title: args.id === '8' ? '另一机型版本' : '12GB版本' }, { id: 72, title: '16GB版本' }], tabList, star_total_count: 100, star_average_score: 4.2, star_5_count: 50, star_4_count: 30, star_3_count: 10, star_2_count: 6, star_1_count: 4, recent_30_days_star_total_count: 12, recent_30_days_star_average_score: 4.1, recent_30_days_goods_percent: 0.9, ...(mock.missingOwnerStats ? {} : { owner_star_total_count: 40, owner_star_average_score: 4.6, owner_star_5_count: 30, owner_star_4_count: 7, owner_star_3_count: 2, owner_star_2_count: 1, owner_star_1_count: 0, recent_30_days_owner_star_total_count: 5, recent_30_days_owner_star_average_score: 4.8, recent_30_days_owner_goods_percent: 100 }), rating_item_info: [{ name: '续航', average_score: 8.3, owner_average_score: 9.1 }, { name: '无效数据', average_score: 'NaN', owner_average_score: null }], ratingFeed: args.id === '58' ? undefined : { id: 799 }, userAction: { rating: 4, ...(args.id === '58' ? { ratingFeedUrl: '/feed/798' } : {}) } } });
      }
      if (operation === 'catalogProductFeeds') {
        const data = list([{ entityType: 'feed', id: 700, username: '模拟酷友', message: args.sort === mock.holdFeedSort && mock.holdFeedSort ? '过期产品排序' : `产品${args.id}的${args.type}内容${args.sort ? ' ' + args.sort : ''}` }]);
        if (args.sort === mock.holdFeedSort && mock.holdFeedSort) return new Promise(resolve => mock.pending.push({ operation, args, resolve: () => resolve(ok(data)) }));
        return ok(data);
      }
      if (operation === 'catalogProductSubtab') return ok({ data: [{ entityType: 'feed', id: args.page === 2 ? 704 : 703, username: '模拟酷友', message: args.page === 2 ? '样张板块第二页' : '样张板块动态' }], firstItem: 'feed_703', lastItem: args.page === 2 ? 'feed_704' : 'feed_703', hasMore: args.page !== 2 });
      if (operation === 'catalogProductRatings') {
        const data = { data: [{ entityType: 'feed', id: 710 + Number(args.star), username: '评分酷友', message: args.star === mock.delayRatingsStar ? '过期评分结果' : `评分筛选 ${args.star || '全部'} 星${args.owner ? '拥有者' : '所有用户'}` }], firstItem: 'rating_first', lastItem: 'rating_last', hasMore: args.page !== 2 };
        if (args.star === mock.delayRatingsStar) return new Promise(resolve => mock.pending.push({ operation, args, resolve: () => resolve(ok(data)) }));
        return ok(data);
      }
      if (operation === 'catalogProductRatingPage') {
        if (args.page === 2 && mock.failRatingMore) { const code = mock.failRatingMore; mock.failRatingMore = ''; return { ok: false, error: { code, message: '模拟排序点评分页失败', ...(code === 'VERIFY_REQUIRED' ? { verificationId: 'rating-sort-page2' } : {}) } }; }
        const option = (title, suffix) => ({ title, url: '/page?url=' + encodeURIComponent(`/product/feedList?id=${args.id}&type=rating${suffix}`) });
        const options = [option('机主', '&isOwner=1'), option('最新', '&listType=dateline_desc'), { title: '好评', url: '/page?url=' + encodeURIComponent(`/product/feedList?id=${args.id}&type=ratingByScore`) }];
        const title = options.find(item => item.url === args.url)?.title;
        const held = mock.holdRatingUrl && args.url.includes(mock.holdRatingUrl);
        const data = { data: [{ entityType: 'feed', id: 740 + (args.page || 1), username: '评分酷友', message: held ? '过期点评排序' : title ? `点评排序 ${title} 第${args.page || 1}页 产品${args.id}` : '评分筛选 全部 星所有用户' }], ratingSortOptions: args.page === 2 ? [] : options, firstItem: 'server_rating_first', lastItem: args.page === 2 ? 'server_rating_last2' : 'server_rating_last1', hasMore: args.page !== 2 };
        if (held) return new Promise(resolve => mock.pending.push({ operation, args, resolve: () => resolve(ok(data)) }));
        return ok(data);
      }
      if (operation === 'catalogProductMedia') {
        const data = { data: [{ id: 760 + (args.page || 1), type: args.type, url: args.type === 'video' ? 'https://video.coolapk.com/video/synthetic-product.webm' : 'https://image.coolapk.com/product/synthetic.png', pic: 'https://image.coolapk.com/product/poster.png', media_info: args.type === 'video' ? JSON.stringify({ cover_url: 'https://image.coolapk.com/product/poster.png' }) : undefined, feed_id: 801, username: args.type === mock.holdProductMedia ? '过期产品媒体' : args.recommended ? '推荐媒体酷友' : '产品媒体酷友' }], hasMore: args.page !== 2, firstItem: 'product_media_first', lastItem: args.page === 2 ? 'product_media_last2' : 'product_media_last1' };
        if (args.type === mock.holdProductMedia) return new Promise(resolve => mock.pending.push({ operation, args, resolve: () => resolve(ok(data)) }));
        return ok(data);
      }
      if (operation === 'catalogProductVersions') return ok({ data: mock.badVersions ? { unexpected: true } : [{ config_id: '9001', config_name: '购买版 128GB', price: '2999' }, { id: '9002', title: '购买版 256GB' }] });
      if (operation === 'page') return ok(list([{ entityType: 'topic', id: 718, title: '鸿蒙话题' }]));
      if (operation === 'nodeAppFeeds') return ok(list([{ entityType: 'feed', id: 730, username: '模拟酷友', message: '节点讨论内容' }]));
      if (operation === 'catalogProductConfig') return ok({ data: { id: args.id, title: args.id === '91' ? '另一机型版本' : args.id === '71' ? '12GB版本' : '16GB版本', cpu: args.id === '91' ? '处理器乙' : '处理器甲', ram: args.id === '71' ? '12GB' : '16GB', config_data: JSON.stringify({ 屏幕: { 尺寸: '6.8英寸', 刷新率: '120Hz' } }) } });
      if (operation === 'catalogProductRatingChart') return ok({ data: Object.fromEntries(['day', 'week', 'month'].map(period => [period, { ratingChart: { x: [{ score: 4.1, count: 12, datelineStr: '测试周期' }] }, ownerRatingChart: { x: [{ score: 4.6, count: 8, datelineStr: '测试周期' }] } }])) });
      if (operation === 'catalogProductBrands' || operation === 'catalogProductCategories') return ok(list([{ id: 10, entityType: 'productCategory', title: '手机分类', url: '#/product/productList?category_id=10' }]));
      if (operation === 'catalogProductCategoryItems' || operation === 'catalogProductBrandItems') return ok(list([{ id: 7, entityType: 'product', title: '测试手机' }]));
      if (operation === 'catalogApp') return ok({ data: { id: 9, aid: 9, packageName: 'com.example.one', title: '应用甲', apkversion: '1.2.0', developer: '测试开发者', description: '<p>应用说明</p>', userAction: {} } });
      if (operation === 'catalogAppVersions') return ok(list([{ id: 3, title: '历史版本1.0' }]));
      if (operation === 'catalogAppComments') {
        const page = args.page || 1, sort = args.sort, uid = mock.uid;
        if (page === 2 && mock.failCommentsMore) { const code = mock.failCommentsMore; mock.failCommentsMore = ''; return { ok: false, error: { code, message: '模拟应用点评分页失败', ...(code === 'VERIFY_REQUIRED' ? { verificationId: 'comments-page2' } : {}) } }; }
        const data = { data: [{ entityType: 'feed', id: 800 + ['lastupdate_desc', 'dateline_desc', 'popular'].indexOf(sort) * 10 + page, username: '模拟酷友', message: sort === mock.holdCommentSort ? '过期应用点评' : `应用点评 ${sort} 第${page}页 ${uid}` }], hasMore: page === 1, firstItem: `comment_${sort}_1`, lastItem: `comment_${sort}_${page}` };
        if (sort === mock.holdCommentSort) return new Promise(resolve => mock.pending.push({ operation, args, resolve: () => resolve(ok(data)) }));
        return ok(data);
      }
      if (operation === 'catalogAlbums' || operation === 'catalogMyAlbums' || operation === 'catalogAlbumSearch') return ok(list([mock.album]));
      if (operation === 'catalogAlbum') return ok({ data: args.id !== '7' ? { ...mock.album, id: Number(args.id), title: '另一应用集', cover: 'https://image.coolapk.com/album/another.png' } : mock.missingApps ? { ...mock.album, apkList: undefined, apkCount: 3 } : mock.album });
      if (operation === 'catalogAlbumCreate') return ok({ data: { id: 8, title: args.title } });
      if (operation === 'catalogAlbumEdit') { Object.assign(mock.album, { title: args.title, intro: args.intro, cover: args.cover }); return ok({ data: mock.album }); }
      if (operation === 'uploadImage') {
        const mode = mock.uploadMode; mock.uploadMode = '';
        if (mode === 'VERIFY_REQUIRED') return { ok: false, error: { code: mode, message: '模拟封面安全验证', verificationId: 'album-cover' } };
        const data = { data: `https://image.coolapk.com/album/synthetic-${++mock.uploadCount}.png` };
        if (mode === 'hold') return new Promise(resolve => mock.pending.push({ operation, args, resolve: () => resolve(ok(data)) }));
        return ok(data);
      }
      if (operation === 'catalogAlbumAddApp') { mock.album.apkList.push({ entityType: 'apk', packageName: args.packageName, title: args.title }); return ok({ data: {} }); }
      if (operation === 'catalogAlbumRemoveApp') { mock.album.apkList = mock.album.apkList.filter(item => item.packageName !== args.packageName); return ok({ data: {} }); }
      if (operation === 'catalogDyhs') return ok(list([{ entityType: 'dyh', id: 3, title: '官方测试号' }]));
      if (operation === 'catalogDyh') return ok({ data: { id: 3, title: '官方测试号', userAction: {} } });
      if (operation === 'catalogDyhFeeds') return ok(list([{ entityType: 'dyhArticle', id: 301, uid: '123456', username: '测试作者', title: '酷安号长文', message_title: '酷安号长文', message: '<p>酷安号文章正文</p>', isHtmlArticle: 1 }]));
      if (operation === 'catalogEvents') return ok(list([{ entityType: 'event', id: 4, title: '摄影活动' }]));
      if (operation === 'catalogEvent') return ok({ data: { id: 4, title: '摄影活动', message: '活动介绍', url: 'https://www.coolapk.com/event/4' } });
      if (operation === 'catalogPictures') return ok(list([{ entityType: 'picture', id: 6, title: '风景', pic: 'https://image.coolapk.com/feed/a.jpg' }]));
      if (['catalogProductWish','catalogProductFollow','catalogCompareAdd','catalogCompareRemove','catalogRating','catalogProductReview','catalogAppFavorite','catalogAppUnfavorite','catalogAppComment','catalogDyhFollow','catalogDyhUnfollow'].includes(operation)) return ok({ data: { id: 70 } });
      return ok(list([]));
    } };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/.local/catalog-check/test.html`);
  // Locally encode actual VP8 frames; only this synthetic CDN URL is fulfilled.
  syntheticVideo = Buffer.from(await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32; canvas.getContext('2d').fillRect(0, 0, 32, 32);
    const stream = canvas.captureStream(30), chunks = [], recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(() => { recorder.stop(); reject(new Error('synthetic product video did not encode')); }, 10000);
      recorder.onerror = event => reject(new Error(event.error?.message || 'synthetic product encoding failed'));
      recorder.ondataavailable = async event => { if (!event.data.size) return; chunks.push(event.data); const bytes = new Uint8Array(await event.data.arrayBuffer()); if (recorder.state === 'recording' && bytes.some((byte, index) => byte === 0x1f && bytes[index + 1] === 0x43 && bytes[index + 2] === 0xb6 && bytes[index + 3] === 0x75)) recorder.stop(); };
      recorder.onstop = async () => { clearTimeout(deadline); stream.getTracks().forEach(track => track.stop()); resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()))); };
      recorder.start(100); let frames = 0; const draw = () => { canvas.getContext('2d').fillStyle = frames++ % 2 ? '#227753' : '#80c5a2'; canvas.getContext('2d').fillRect(0, 0, 32, 32); if (recorder.state === 'recording') requestAnimationFrame(draw); }; requestAnimationFrame(draw);
    });
  }));
  assert.ok(syntheticVideo.length > 100);
  await page.getByRole('button', { name: /数码资料库/ }).waitFor();
  const navigate = (type, id) => page.evaluate(({ type, id }) => window.__catalogNavigate(type, id), { type, id });
  const lastCall = () => page.evaluate(() => window.__catalogMock.calls.at(-1));
  const calls = () => page.evaluate(() => window.__catalogMock.calls);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const coverFile = { name: 'synthetic-cover.png', mimeType: 'image/png', buffer: Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24; canvas.getContext('2d').fillRect(0, 0, 32, 24); return canvas.toDataURL('image/png').split(',')[1]; }), 'base64') };
  const pickCover = dialog => dialog.getByLabel('选择应用集封面图片', { exact: true }).setInputFiles(coverFile);
  const waitUploadedCover = () => page.waitForFunction(() => document.querySelector('[aria-label="选择应用集封面图片"]')?.disabled === false && document.querySelector('[aria-label="应用集封面"]')?.value === `https://image.coolapk.com/album/synthetic-${window.__catalogMock.uploadCount}.png` && !document.querySelector('[role="dialog"] [role="alert"]'));
  const openAlbumEditor = async (id = '7') => { await navigate('album', id); await page.getByRole('button', { name: '编辑应用集', exact: true }).click(); return page.getByRole('dialog', { name: '编辑应用集', exact: true }); };
  await record('catalog discovery opens fixed product classification context', async () => {
    await page.getByRole('button', { name: /数码资料库/ }).click(); await page.getByRole('button', { name: /手机分类/ }).click();
    await page.getByRole('button', { name: /测试手机/ }).waitFor();
    assert.ok((await calls()).some(item => item.operation === 'catalogProductCategoryItems' && item.args.url === '#/product/productList?category_id=10'));
  });
  await record('official product columns retain order and labels while hidden, duplicate, wrong-product and unsafe routes are excluded', async () => {
    await navigate('product', '7'); const tabs = page.getByRole('tablist', { name: '产品栏目', exact: true }); await tabs.waitFor();
    assert.deepEqual(await tabs.getByRole('tab').allTextContents(), ['讨论', '样张板块', '点评栏目', '图文栏目', '鸿蒙栏目']);
    await tabs.getByRole('tab', { name: '图文栏目', exact: true }).click(); await page.getByText('产品7的article内容', { exact: true }).waitFor();
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductFeeds').at(-1).args, { id: '7', type: 'article', sort: '' });
    await tabs.getByRole('tab', { name: '鸿蒙栏目', exact: true }).click(); await page.getByRole('button', { name: /鸿蒙话题/ }).waitFor();
    assert.deepEqual((await calls()).filter(item => item.operation === 'page').at(-1).args, { url: '/topic/tagList?keywords=鸿蒙' });
    assert.equal((await calls()).some(item => JSON.stringify(item.args).includes('evil.test') || JSON.stringify(item.args).includes('deleteFeed')), false);
  });
  await record('server product sub-board IDs are preserved exactly through independent pagination', async () => {
    await page.getByRole('tab', { name: '样张板块', exact: true }).click(); await page.getByText('样张板块动态', { exact: true }).waitFor();
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductSubtab').at(-1).args, { id: '7', subId: '004' });
    await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByText('样张板块第二页', { exact: true }).waitFor();
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductSubtab').at(-1).args, { id: '7', subId: '004', page: 2, firstItem: 'feed_703', lastItem: 'feed_703' });
  });
  await record('rating star and owner filters use confirmed fields and restart pagination on changes and tab return', async () => {
    await page.getByRole('tab', { name: '点评栏目', exact: true }).click(); await page.getByText('评分筛选 全部 星所有用户', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: '点评星级', exact: true }).selectOption('4'); await page.getByRole('checkbox', { name: '仅看拥有者点评' }).check();
    await page.getByText('评分筛选 4 星拥有者', { exact: true }).waitFor();
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductRatings').at(-1).args, { id: '7', star: 4, owner: true });
    await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByRole('button', { name: '已经看完了', exact: true }).waitFor();
    assert.equal((await calls()).filter(item => item.operation === 'catalogProductRatings').at(-1).args.page, 2);
    await page.getByRole('combobox', { name: '点评星级', exact: true }).selectOption('2'); await page.getByText('评分筛选 2 星拥有者', { exact: true }).waitFor();
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductRatings').at(-1).args, { id: '7', star: 2, owner: true });
    await page.getByRole('tab', { name: '讨论', exact: true }).click(); await page.getByRole('tab', { name: '点评栏目', exact: true }).click();
    assert.equal(await page.getByRole('combobox', { name: '点评星级', exact: true }).inputValue(), '0'); assert.equal(await page.getByRole('checkbox', { name: '仅看拥有者点评' }).isChecked(), false);
  });
  await record('late rating responses cannot replace new filters or a different account and product', async () => {
    await page.evaluate(() => { window.__catalogMock.delayRatingsStar = 3; });
    await page.getByRole('combobox', { name: '点评星级', exact: true }).selectOption('3'); await page.waitForFunction(() => window.__catalogMock.pending.length > 0);
    await page.getByRole('combobox', { name: '点评星级', exact: true }).selectOption('4'); await page.getByText('评分筛选 4 星所有用户', { exact: true }).waitFor();
    await page.evaluate(() => { window.__catalogMock.pending.splice(0).forEach(item => item.resolve()); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert.equal(await page.getByText('过期评分结果', { exact: true }).count(), 0);
    await page.evaluate(() => { window.__catalogMock.delayRatingsStar = 2; }); await page.getByRole('combobox', { name: '点评星级', exact: true }).selectOption('2'); await page.waitForFunction(() => window.__catalogMock.pending.length > 0);
    await page.evaluate(() => window.__catalogAccount('654321')); await navigate('product', '8'); await page.getByRole('tab', { name: '点评栏目', exact: true }).click();
    await page.getByText('评分筛选 全部 星所有用户', { exact: true }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: '点评星级', exact: true }).inputValue(), '0');
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductRatingPage').at(-1).args, { id: '8', url: '/page?url=' + encodeURIComponent('/product/feedList?id=8&type=rating') });
    await page.evaluate(() => { window.__catalogMock.pending.splice(0).forEach(item => item.resolve()); window.__catalogMock.delayRatingsStar = -1; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert.equal(await page.getByText('过期评分结果', { exact: true }).count(), 0);
    await page.evaluate(() => window.__catalogAccount('123456'));
  });
  await record('purchasable versions use the separate version operation and malformed reads remain retryable errors', async () => {
    await page.evaluate(() => { window.__catalogMock.badVersions = true; }); await navigate('product', '42'); await page.getByRole('tab', { name: '可购买版本', exact: true }).click();
    await page.getByText('酷安返回的可购买版本结构异常', { exact: true }).waitFor(); assert.equal(await page.getByText('暂未提供可购买版本', { exact: true }).count(), 0);
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductVersions').at(-1).args, { id: '42' });
    await page.evaluate(() => { window.__catalogMock.badVersions = false; }); await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByText('购买版 128GB', { exact: true }).waitFor(); await page.getByText('配置编号 9001', { exact: true }).waitFor();
    assert.equal(await page.locator('.catalog-version-list').getByText('12GB版本', { exact: true }).count(), 0);
  });
  await record('explicitly empty server tabList does not synthesize official columns', async () => {
    await page.evaluate(() => { window.__catalogMock.emptyProductTabs = true; }); await navigate('product', '43'); await page.getByText('服务端暂未提供可用的产品栏目。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('tablist', { name: '产品栏目', exact: true }).count(), 0);
    assert.equal(await page.getByRole('tablist', { name: '产品功能', exact: true }).count(), 1); await page.evaluate(() => { window.__catalogMock.emptyProductTabs = false; });
  });
  await record('sub-board read failures retain their error and retry the same exact board rather than another feed', async () => {
    await navigate('product', '44'); await page.getByRole('tablist', { name: '产品栏目', exact: true }).waitFor(); await page.evaluate(() => { window.__catalogMock.failOnce = 'catalogProductSubtab'; });
    await page.getByRole('tab', { name: '样张板块', exact: true }).click(); await page.getByText('模拟网络失败', { exact: true }).waitFor();
    assert.equal(await page.getByText('这里还没有内容', { exact: true }).count(), 0); await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('样张板块动态', { exact: true }).waitFor();
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductSubtab').at(-1).args, { id: '44', subId: '004' });
  });
  await record('sub-board page-two network retry retains page one and repeats exact failed cursors', async () => {
    await navigate('product', '45'); await page.getByRole('tab', { name: '样张板块', exact: true }).click(); await page.getByText('样张板块动态', { exact: true }).waitFor();
    await page.evaluate(() => { window.__catalogMock.failSubtabMore = 'NETWORK'; }); await page.getByRole('button', { name: '加载更多', exact: true }).click();
    await page.getByText('模拟第二页网络失败', { exact: true }).waitFor(); assert.equal(await page.getByText('样张板块动态', { exact: true }).count(), 1);
    await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('样张板块第二页', { exact: true }).waitFor();
    const requested = (await calls()).filter(item => item.operation === 'catalogProductSubtab' && item.args.id === '45');
    assert.deepEqual(requested.map(item => item.args.page || 1), [1, 2, 2]); assert.deepEqual(requested[2].args, requested[1].args);
    assert.equal(await page.getByText('样张板块动态', { exact: true }).count(), 1);
  });
  await record('sub-board page-two verification completion retries page two instead of restarting page one', async () => {
    await navigate('product', '46'); await page.getByRole('tab', { name: '样张板块', exact: true }).click(); await page.getByText('样张板块动态', { exact: true }).waitFor();
    await page.evaluate(() => { window.__catalogMock.failSubtabMore = 'VERIFY_REQUIRED'; }); await page.getByRole('button', { name: '加载更多', exact: true }).click();
    await page.getByText('模拟第二页验证', { exact: true }).waitFor(); assert.equal(await page.getByText('样张板块动态', { exact: true }).count(), 1);
    await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.getByText('样张板块第二页', { exact: true }).waitFor();
    const requested = (await calls()).filter(item => item.operation === 'catalogProductSubtab' && item.args.id === '46');
    assert.deepEqual(requested.map(item => item.args.page || 1), [1, 2, 2]); assert.deepEqual(requested[2].args, requested[1].args);
    assert.deepEqual(await page.evaluate(() => window.__catalogMock.verifications), ['catalog-page2']); assert.equal(await page.getByText('样张板块动态', { exact: true }).count(), 1);
  });
  await productRecord('product feed default/latest/hot sorting uses the confirmed listType and rejects late prior sort rows', async () => {
    await navigate('product', '50'); await page.getByRole('tab', { name: '讨论', exact: true }).waitFor();
    await page.getByText('产品50的feed内容', { exact: true }).waitFor();
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductFeeds' && item.args.id === '50').at(-1).args, { id: '50', type: 'feed', sort: '' });
    await page.evaluate(() => { window.__catalogMock.holdFeedSort = 'dateline_desc'; }); await page.getByLabel('产品动态排序', { exact: true }).selectOption('dateline_desc');
    await page.waitForFunction(() => window.__catalogMock.pending.some(item => item.operation === 'catalogProductFeeds'));
    await page.getByLabel('产品动态排序', { exact: true }).selectOption('rank_score'); await page.getByText('产品50的feed内容 rank_score', { exact: true }).waitFor();
    await page.evaluate(() => { window.__catalogMock.pending.splice(0).forEach(item => item.resolve()); window.__catalogMock.holdFeedSort = ''; }); await settle();
    assert.equal(await page.getByText('过期产品排序', { exact: true }).count(), 0);
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductFeeds' && item.args.id === '50').map(item => item.args.sort), ['', 'dateline_desc', 'rank_score']);
  });
  await productRecord('product rating overview uses exact all/owner distributions, recent statistics and own review navigation', async () => {
    await page.getByRole('tab', { name: '点评栏目', exact: true }).click(); await page.getByText('评分筛选 全部 星所有用户', { exact: true }).waitFor();
    const summary = page.getByRole('region', { name: '产品评分概览' }); await summary.getByText('8.4', { exact: true }).waitFor(); await summary.getByText('100 人评分', { exact: true }).waitFor();
    assert.deepEqual(await summary.locator('.catalog-rating-distribution>div>span:last-child').allTextContents(), ['50', '30', '10', '6', '4']);
    assert.ok((await summary.innerText()).includes('最近 30 天：8.2 分 · 12 人评分 · 好评率 90%')); assert.ok((await summary.innerText()).includes('续航 8.3'));
    const before = (await calls()).length; await summary.getByRole('tab', { name: '机主', exact: true }).click(); await summary.getByText('9.2', { exact: true }).waitFor();
    assert.deepEqual(await summary.locator('.catalog-rating-distribution>div>span:last-child').allTextContents(), ['30', '7', '2', '1', '0']); assert.ok((await summary.innerText()).includes('最近 30 天：9.6 分 · 5 人评分 · 好评率 100%')); assert.equal((await calls()).length, before);
    await summary.getByRole('button', { name: '查看我的点评', exact: true }).click(); assert.equal(await page.evaluate(() => window.__catalogMock.opened.at(-1).id), '799');
    await page.evaluate(() => { window.__catalogMock.missingOwnerStats = true; }); await navigate('product', '51'); await page.getByRole('tab', { name: '点评栏目', exact: true }).click();
    await summary.getByText('100 人评分', { exact: true }).waitFor(); await summary.getByRole('tab', { name: '机主', exact: true }).click(); await summary.getByText('暂未提供机主评分统计', { exact: true }).waitFor(); assert.equal(await summary.getByText('8.4', { exact: true }).count(), 0);
    await page.evaluate(() => { window.__catalogMock.missingOwnerStats = false; }); await navigate('product', '58'); await page.getByRole('tab', { name: '点评栏目', exact: true }).click(); await summary.getByRole('button', { name: '查看我的点评', exact: true }).click(); assert.equal(await page.evaluate(() => window.__catalogMock.opened.at(-1).id), '798');
  });
  await productRecord('server rating sort labels and descriptors remain authoritative and sorting restarts exact page-one cursors', async () => {
    await navigate('product', '52'); await page.getByRole('tab', { name: '点评栏目', exact: true }).click(); const sorts = page.getByRole('tablist', { name: '服务端点评排序', exact: true }); await sorts.waitFor();
    assert.deepEqual(await sorts.getByRole('tab').allTextContents(), ['机主', '最新', '好评']); await sorts.getByRole('tab', { name: '最新', exact: true }).click(); await page.getByText('点评排序 最新 第1页 产品52', { exact: true }).waitFor();
    const url = '/page?url=' + encodeURIComponent('/product/feedList?id=52&type=rating&listType=dateline_desc');
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductRatingPage' && item.args.id === '52').at(-1).args, { id: '52', url });
    await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByText('点评排序 最新 第2页 产品52', { exact: true }).waitFor();
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductRatingPage' && item.args.id === '52').at(-1).args, { id: '52', url, page: 2, firstItem: 'server_rating_first', lastItem: 'server_rating_last1' }); assert.deepEqual(await sorts.getByRole('tab').allTextContents(), ['机主', '最新', '好评']);
    await sorts.getByRole('tab', { name: '好评', exact: true }).click(); await page.getByText('点评排序 好评 第1页 产品52', { exact: true }).waitFor();
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductRatingPage' && item.args.id === '52').at(-1).args, { id: '52', url: '/page?url=' + encodeURIComponent('/product/feedList?id=52&type=ratingByScore') });
  });
  await productRecord('server rating sort and explicit star-owner filters stay separate confirmed contracts', async () => {
    await page.getByLabel('点评星级', { exact: true }).selectOption('5'); await page.getByRole('checkbox', { name: '仅看拥有者点评' }).check(); await page.getByText('评分筛选 5 星拥有者', { exact: true }).waitFor();
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductRatings').at(-1).args, { id: '52', star: 5, owner: true }); assert.equal(await page.getByRole('tablist', { name: '服务端点评排序' }).locator('[aria-selected=true]').count(), 0);
    await page.getByRole('tablist', { name: '服务端点评排序' }).getByRole('tab', { name: '机主', exact: true }).click(); await page.getByText('点评排序 机主 第1页 产品52', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('点评星级', { exact: true }).inputValue(), '0'); assert.equal(await page.getByRole('checkbox', { name: '仅看拥有者点评' }).isChecked(), false);
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductRatingPage' && item.args.id === '52').at(-1).args, { id: '52', url: '/page?url=' + encodeURIComponent('/product/feedList?id=52&type=rating&isOwner=1') });
  });
  for (const code of ['NETWORK', 'VERIFY_REQUIRED']) await productRecord(`rating sorted page-two ${code} retries exact failed descriptor/cursors while retaining rows`, async () => {
    const id = code === 'NETWORK' ? '53' : '54'; await navigate('product', id); await page.getByRole('tab', { name: '点评栏目', exact: true }).click(); await page.getByRole('tablist', { name: '服务端点评排序' }).getByRole('tab', { name: '好评', exact: true }).click(); await page.getByText(`点评排序 好评 第1页 产品${id}`, { exact: true }).waitFor();
    await page.evaluate(code => { window.__catalogMock.failRatingMore = code; }, code); await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByText('模拟排序点评分页失败', { exact: true }).waitFor(); assert.equal(await page.getByText(`点评排序 好评 第1页 产品${id}`, { exact: true }).count(), 1);
    await page.getByRole('button', { name: code === 'NETWORK' ? '重试' : '完成验证', exact: true }).click(); await page.getByText(`点评排序 好评 第2页 产品${id}`, { exact: true }).waitFor();
    const requests = (await calls()).filter(item => item.operation === 'catalogProductRatingPage' && item.args.id === id && item.args.url.includes('ratingByScore')); assert.deepEqual(requests.map(item => item.args.page || 1), [1, 2, 2]); assert.deepEqual(requests[1].args, requests[2].args); assert.equal(await page.getByText(`点评排序 好评 第1页 产品${id}`, { exact: true }).count(), 1);
  });
  await productRecord('late sorted rating reads cannot overwrite newer filters, accounts or products', async () => {
    await page.evaluate(() => { window.__catalogMock.holdRatingUrl = 'dateline_desc'; }); await page.getByRole('tablist', { name: '服务端点评排序' }).getByRole('tab', { name: '最新', exact: true }).click(); await page.waitForFunction(() => window.__catalogMock.pending.some(item => item.operation === 'catalogProductRatingPage'));
    await page.getByLabel('点评星级', { exact: true }).selectOption('2'); await page.getByText('评分筛选 2 星所有用户', { exact: true }).waitFor(); await page.evaluate(() => { window.__catalogMock.pending.splice(0).forEach(item => item.resolve()); }); await settle(); assert.equal(await page.getByText('过期点评排序', { exact: true }).count(), 0);
    await page.getByRole('tablist', { name: '服务端点评排序' }).getByRole('tab', { name: '最新', exact: true }).click(); await page.waitForFunction(() => window.__catalogMock.pending.some(item => item.operation === 'catalogProductRatingPage'));
    await page.evaluate(() => window.__catalogAccount('654321')); await navigate('product', '55'); await page.waitForFunction(() => document.querySelector('main')?.dataset.account === '654321' && document.querySelector('main')?.dataset.product === '55');
    await page.getByRole('tab', { name: '点评栏目', exact: true }).click(); await page.getByRole('tablist', { name: '服务端点评排序' }).getByRole('tab', { name: '好评', exact: true }).click(); await page.getByText('点评排序 好评 第1页 产品55', { exact: true }).waitFor();
    await page.evaluate(() => { window.__catalogMock.pending.splice(0).forEach(item => item.resolve()); window.__catalogMock.holdRatingUrl = ''; }); await settle(); assert.equal(await page.getByText('过期点评排序', { exact: true }).count(), 0); assert.equal(await page.getByText('点评排序 好评 第1页 产品55', { exact: true }).count(), 1); await page.evaluate(() => window.__catalogAccount('123456'));
  });
  await productRecord('product media image/recommend/video filters play direct video and navigate exact original feeds', async () => {
    await navigate('product', '56'); await page.getByRole('tab', { name: '媒体', exact: true }).click(); const filters = page.getByRole('tablist', { name: '产品媒体筛选' }); await page.getByRole('button', { name: '查看产品图片 1', exact: true }).waitFor();
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductMedia').at(-1).args, { id: '56', type: 'image', recommended: 0 }); await page.getByRole('button', { name: '查看产品图片 1', exact: true }).click(); await page.getByRole('button', { name: '关闭', exact: true }).click();
    await filters.getByRole('tab', { name: '推荐', exact: true }).click(); await page.getByText('查看图片 · 推荐媒体酷友', { exact: true }).waitFor(); assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductMedia').at(-1).args, { id: '56', type: 'image', recommended: 1 });
    await filters.getByRole('tab', { name: '视频', exact: true }).click(); await page.getByRole('button', { name: '播放产品视频 1', exact: true }).click(); const video = page.getByLabel('产品视频播放器', { exact: true }); await video.waitFor(); assert.equal(await video.getAttribute('src'), 'https://video.coolapk.com/video/synthetic-product.webm');
    await page.waitForFunction(() => document.querySelector('.catalog-product-media video')?.readyState >= 2 && document.querySelector('.catalog-product-media video')?.videoWidth > 0); await video.evaluate(video => { video.muted = true; video.loop = true; return video.play(); }); await page.waitForFunction(() => document.querySelector('.catalog-product-media video')?.getVideoPlaybackQuality().totalVideoFrames > 0); await video.evaluate(video => video.pause());
    assert.equal((await calls()).some(item => item.operation === 'video'), false); await page.getByRole('button', { name: '查看原动态', exact: true }).click(); assert.equal(await page.evaluate(() => window.__catalogMock.opened.at(-1).id), '801');
    await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByRole('button', { name: '已经看完了', exact: true }).waitFor(); assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductMedia').at(-1).args, { id: '56', type: 'video', recommended: 0, page: 2, firstItem: 'product_media_first', lastItem: 'product_media_last1' });
  });
  await productRecord('product media errors retry exact filters and delayed previous filter rows stay rejected', async () => {
    await navigate('product', '57'); await page.evaluate(() => { window.__catalogMock.failOnce = 'catalogProductMedia'; }); await page.getByRole('tab', { name: '媒体', exact: true }).click(); await page.getByText('模拟网络失败', { exact: true }).waitFor(); await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByRole('button', { name: '查看产品图片 1', exact: true }).waitFor();
    await page.evaluate(() => { window.__catalogMock.holdProductMedia = 'video'; }); await page.getByRole('tablist', { name: '产品媒体筛选' }).getByRole('tab', { name: '视频', exact: true }).click(); await page.waitForFunction(() => window.__catalogMock.pending.some(item => item.operation === 'catalogProductMedia'));
    await page.getByRole('tablist', { name: '产品媒体筛选' }).getByRole('tab', { name: '推荐', exact: true }).click(); await page.getByText('查看图片 · 推荐媒体酷友', { exact: true }).waitFor(); await page.evaluate(() => { window.__catalogMock.pending.splice(0).forEach(item => item.resolve()); window.__catalogMock.holdProductMedia = ''; }); await settle(); assert.equal(await page.getByText(/过期产品媒体/).count(), 0); assert.equal(await page.getByLabel('产品视频播放器', { exact: true }).count(), 0);
  });
  await record('product parameters compare variants and another model, retaining differences', async () => {
    await navigate('product', '7'); await page.getByRole('tab', { name: '参数对比', exact: true }).click();
    await page.getByText('处理器甲', { exact: true }).waitFor(); await page.getByRole('button', { name: '加入本次对比' }).click();
    await page.getByRole('combobox', { name: '产品版本配置' }).selectOption('72');
    await page.getByRole('button', { name: '加入本次对比' }).click();
    await page.getByRole('button', { name: '添加其他机型' }).click();
    const picker = page.getByRole('dialog', { name: '添加对比机型' });
    await picker.getByRole('textbox', { name: '搜索对比机型' }).fill('另一款'); await picker.getByRole('button', { name: '搜索机型' }).click();
    await picker.getByRole('button', { name: '另一款手机', exact: true }).click(); await picker.getByRole('button', { name: '另一机型版本', exact: true }).click();
    await picker.waitFor({ state: 'hidden' }); assert.equal(await page.locator('.catalog-comparison thead th').count(), 4);
    assert.ok(await page.locator('.catalog-comparison tr.different').count() > 0);
  });
  await record('product wish/follow and purchased review use distinct interactions', async () => {
    await page.getByRole('button', { name: '想买', exact: true }).click();
    assert.equal((await lastCall()).operation === 'catalogProduct' || (await calls()).some(item => item.operation === 'catalogProductWish'), true);
    await page.getByRole('button', { name: '关注', exact: true }).click();
    await page.getByRole('button', { name: '评分与已买点评' }).click();
    const editor = page.getByRole('dialog', { name: '产品评分与点评' }); await editor.getByLabel('产品评分', { exact: true }).selectOption('5'); await editor.getByRole('textbox', { name: '产品点评' }).fill('模拟使用感受');
    await editor.getByRole('checkbox').check(); await editor.getByRole('button', { name: '发布点评' }).click(); await editor.waitFor({ state: 'hidden' });
    assert.ok((await calls()).some(item => item.operation === 'catalogProductReview' && item.args.bought === true && item.args.score === 5));
  });
  await record('product rating trend uses server periods and owner samples', async () => {
    await page.getByRole('tab', { name: '评分趋势', exact: true }).click();
    await page.getByText('4.10 分 · 12 人', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: '评分趋势周期' }).selectOption('month');
    await page.getByRole('checkbox', { name: '仅看拥有者评分' }).check();
    await page.getByText('4.60 分 · 8 人', { exact: true }).waitFor();
    assert.equal(await page.getByRole('img', { name: '评分趋势曲线' }).count(), 1);
  });
  await record('application information, historical versions and star rating are reachable', async () => {
    await navigate('app', 'com.example.one'); await page.getByText('1.2.0', { exact: true }).waitFor();
    await page.getByRole('button', { name: '保存应用评分' }).click();
    assert.ok((await calls()).some(item => item.operation === 'catalogRating' && item.args.id === 'com.example.one'));
    await page.getByRole('tab', { name: '历史版本', exact: true }).click(); await page.getByRole('button', { name: /历史版本1.0/ }).waitFor();
  });
  await record('application node discussion is a separate read entry with the confirmed default sort', async () => {
    await page.getByRole('tab', { name: '节点讨论', exact: true }).click(); await page.getByText('节点讨论内容', { exact: true }).waitFor();
    assert.deepEqual((await calls()).filter(item => item.operation === 'nodeAppFeeds').at(-1).args, { id: 'com.example.one', sort: 'lastupdate_desc' });
    assert.equal(await page.getByRole('textbox', { name: '应用评价', exact: true }).count(), 0);
  });
  await record('application comments expose all three confirmed sorts and sort changes reset page and cursors', async () => {
    await navigate('app', 'com.example.sort'); await page.getByRole('tab', { name: '点评', exact: true }).click();
    await page.getByText('应用点评 lastupdate_desc 第1页 123456', { exact: true }).waitFor();
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogAppComments').at(-1).args, { id: 'com.example.sort', sort: 'lastupdate_desc' });
    await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByText('应用点评 lastupdate_desc 第2页 123456', { exact: true }).waitFor();
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogAppComments').at(-1).args, { id: 'com.example.sort', sort: 'lastupdate_desc', page: 2, firstItem: 'comment_lastupdate_desc_1', lastItem: 'comment_lastupdate_desc_1' });
    for (const sort of ['dateline_desc', 'popular']) {
      await page.getByRole('combobox', { name: '应用点评排序' }).selectOption(sort); await page.getByText(`应用点评 ${sort} 第1页 123456`, { exact: true }).waitFor();
      assert.deepEqual((await calls()).filter(item => item.operation === 'catalogAppComments').at(-1).args, { id: 'com.example.sort', sort });
      assert.equal(await page.getByText('应用点评 lastupdate_desc 第2页 123456', { exact: true }).count(), 0);
    }
  });
  await record('application comment page-two network retry retains page one and the exact failed request', async () => {
    await navigate('app', 'com.example.network'); await page.getByRole('tab', { name: '点评', exact: true }).click(); await page.getByText('应用点评 lastupdate_desc 第1页 123456', { exact: true }).waitFor();
    await page.evaluate(() => { window.__catalogMock.failCommentsMore = 'NETWORK'; }); await page.getByRole('button', { name: '加载更多', exact: true }).click();
    await page.getByText('模拟应用点评分页失败', { exact: true }).waitFor(); assert.equal(await page.getByText('应用点评 lastupdate_desc 第1页 123456', { exact: true }).count(), 1);
    await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('应用点评 lastupdate_desc 第2页 123456', { exact: true }).waitFor();
    const requested = (await calls()).filter(item => item.operation === 'catalogAppComments' && item.args.id === 'com.example.network');
    assert.deepEqual(requested.filter(item => item.args.page).map(item => item.args.page), [2, 2]); assert.deepEqual(requested.at(-1).args, requested.at(-2).args);
    assert.equal(await page.getByText('应用点评 lastupdate_desc 第1页 123456', { exact: true }).count(), 1);
  });
  await record('application comment verification retries the same page-two sort and cursors', async () => {
    await navigate('app', 'com.example.verification'); await page.getByRole('tab', { name: '点评', exact: true }).click(); await page.getByRole('combobox', { name: '应用点评排序' }).selectOption('popular'); await page.getByText('应用点评 popular 第1页 123456', { exact: true }).waitFor();
    await page.evaluate(() => { window.__catalogMock.failCommentsMore = 'VERIFY_REQUIRED'; }); await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByText('模拟应用点评分页失败', { exact: true }).waitFor();
    await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.getByText('应用点评 popular 第2页 123456', { exact: true }).waitFor();
    const requested = (await calls()).filter(item => item.operation === 'catalogAppComments' && item.args.id === 'com.example.verification' && item.args.sort === 'popular' && item.args.page);
    assert.equal(requested.length, 2); assert.deepEqual(requested[0].args, requested[1].args); assert.ok((await page.evaluate(() => window.__catalogMock.verifications)).includes('comments-page2'));
    assert.equal(await page.getByText('应用点评 popular 第1页 123456', { exact: true }).count(), 1);
  });
  await record('late application comment results cannot cross sort or account scope', async () => {
    await navigate('app', 'com.example.isolation'); await page.getByRole('tab', { name: '点评', exact: true }).click(); await page.getByText('应用点评 lastupdate_desc 第1页 123456', { exact: true }).waitFor();
    await page.evaluate(() => { window.__catalogMock.holdCommentSort = 'popular'; }); await page.getByRole('combobox', { name: '应用点评排序' }).selectOption('popular'); await page.waitForFunction(() => window.__catalogMock.pending.some(item => item.operation === 'catalogAppComments'));
    await page.getByRole('combobox', { name: '应用点评排序' }).selectOption('dateline_desc'); await page.getByText('应用点评 dateline_desc 第1页 123456', { exact: true }).waitFor();
    await page.evaluate(() => window.__catalogMock.pending.splice(0).forEach(item => item.resolve())); await settle(); assert.equal(await page.getByText('过期应用点评', { exact: true }).count(), 0);
    await page.getByRole('combobox', { name: '应用点评排序' }).selectOption('popular'); await page.waitForFunction(() => window.__catalogMock.pending.some(item => item.operation === 'catalogAppComments'));
    await page.evaluate(() => window.__catalogAccount('654321')); await page.getByRole('tab', { name: '点评', exact: true }).click(); await page.getByText('应用点评 lastupdate_desc 第1页 654321', { exact: true }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: '应用点评排序' }).inputValue(), 'lastupdate_desc');
    await page.evaluate(() => { window.__catalogMock.pending.splice(0).forEach(item => item.resolve()); window.__catalogMock.holdCommentSort = ''; }); await settle(); assert.equal(await page.getByText('过期应用点评', { exact: true }).count(), 0);
    await page.evaluate(() => window.__catalogAccount('123456'));
  });
  await record('application collection can be created and modified with confirmed removal', async () => {
    await navigate('albums'); await page.getByRole('button', { name: '创建应用集', exact: true }).click();
    const creator = page.getByRole('dialog', { name: '创建应用集' }); await creator.getByRole('textbox', { name: '应用集名称' }).fill('新工具箱');
    await creator.getByRole('button', { name: '保存应用集' }).click(); await creator.waitFor({ state: 'hidden' });
    assert.ok((await calls()).some(item => item.operation === 'catalogAlbumCreate' && item.args.title === '新工具箱'));
    await navigate('album', '7'); await page.getByRole('button', { name: '添加应用', exact: true }).click();
    const adding = page.getByRole('dialog', { name: '添加应用到应用集' }); await adding.getByRole('textbox', { name: '应用包名' }).fill('com.example.two');
    await adding.getByRole('textbox', { name: '应用名称' }).fill('应用乙'); await adding.getByRole('button', { name: '确认添加' }).click(); await adding.waitFor({ state: 'hidden' });
    const row = page.locator('.catalog-album-row').filter({ hasText: '应用乙' }); await row.waitFor();
    const before = (await calls()).filter(item => item.operation === 'catalogAlbumRemoveApp').length;
    await row.getByRole('button', { name: '移除应用', exact: true }).click();
    const removing = page.getByRole('dialog', { name: '移除应用' }); assert.equal((await calls()).filter(item => item.operation === 'catalogAlbumRemoveApp').length, before);
    await removing.getByRole('button', { name: '关闭', exact: true }).click(); assert.equal((await calls()).filter(item => item.operation === 'catalogAlbumRemoveApp').length, before);
    await row.getByRole('button', { name: '移除应用', exact: true }).click(); await removing.getByRole('button', { name: '确认移除应用' }).click(); await removing.waitFor({ state: 'hidden' });
    assert.equal(await row.count(), 0);
  });
  await record('application collection creation uploads a local cover using only the album payload before explicit save', async () => {
    await navigate('albums'); await page.getByRole('button', { name: '创建应用集', exact: true }).click(); const editor = page.getByRole('dialog', { name: '创建应用集', exact: true });
    await editor.getByRole('textbox', { name: '应用集名称' }).fill('本地封面应用集'); await editor.getByRole('textbox', { name: '应用集介绍' }).fill('保留介绍草稿');
    const before = (await calls()).filter(item => item.operation === 'catalogAlbumCreate').length;
    await pickCover(editor); await waitUploadedCover(); const cover = await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue();
    const request = (await calls()).filter(item => item.operation === 'uploadImage').at(-1); assert.deepEqual(request.args, { bytes: [...coverFile.buffer], width: 32, height: 24, dir: 'album' });
    assert.equal((await calls()).filter(item => item.operation === 'catalogAlbumCreate').length, before);
    await editor.getByRole('button', { name: '保存应用集', exact: true }).click(); await editor.waitFor({ state: 'hidden' });
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogAlbumCreate').at(-1).args, { title: '本地封面应用集', intro: '保留介绍草稿', cover });
  });
  await record('editing an application collection saves the uploaded cover with its existing ID and draft fields', async () => {
    const editor = await openAlbumEditor(); await editor.getByRole('textbox', { name: '应用集名称' }).fill('已更新工具箱'); await editor.getByRole('textbox', { name: '应用集介绍' }).fill('编辑封面说明');
    await pickCover(editor); await waitUploadedCover(); const cover = await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue();
    await editor.getByRole('button', { name: '保存应用集', exact: true }).click(); await editor.waitFor({ state: 'hidden' });
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogAlbumEdit').at(-1).args, { id: '7', title: '已更新工具箱', intro: '编辑封面说明', cover });
    assert.equal(await page.evaluate(() => window.__catalogMock.album.cover), cover);
  });
  await record('invalid, empty and over-limit local covers and cancelled file selection preserve the existing cover and draft', async () => {
    const editor = await openAlbumEditor(); const original = await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue();
    await editor.getByRole('textbox', { name: '应用集名称' }).fill('未保存名称草稿'); const before = (await calls()).filter(item => ['uploadImage', 'catalogAlbumEdit'].includes(item.operation)).length;
    for (const file of [{ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('bad') }, { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) }, { name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(20 * 1024 * 1024 + 1) }, { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') }]) {
      await editor.getByLabel('选择应用集封面图片', { exact: true }).setInputFiles(file); await editor.getByRole('alert').waitFor();
      assert.equal(await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue(), original); assert.equal(await editor.getByRole('textbox', { name: '应用集名称' }).inputValue(), '未保存名称草稿');
      assert.equal(await editor.getByRole('button', { name: '保存应用集', exact: true }).isDisabled(), true); await editor.getByRole('button', { name: '取消本次封面上传', exact: true }).click();
    }
    await editor.getByLabel('选择应用集封面图片', { exact: true }).setInputFiles([]); await settle();
    assert.equal(await editor.getByRole('alert').count(), 0); assert.equal(await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue(), original);
    assert.equal((await calls()).filter(item => ['uploadImage', 'catalogAlbumEdit'].includes(item.operation)).length, before); await editor.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('failed cover upload preserves the old cover and draft while retry repeats exact bytes without saving partial state', async () => {
    const editor = await openAlbumEditor(); const original = await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue(); await editor.getByRole('textbox', { name: '应用集名称' }).fill('网络失败草稿');
    const before = (await calls()).filter(item => item.operation === 'catalogAlbumEdit').length; await page.evaluate(() => { window.__catalogMock.failOnce = 'uploadImage'; }); await pickCover(editor); await editor.getByText('模拟网络失败', { exact: true }).waitFor();
    assert.equal(await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue(), original); assert.equal(await editor.getByRole('textbox', { name: '应用集名称' }).inputValue(), '网络失败草稿'); assert.equal(await editor.getByRole('button', { name: '保存应用集', exact: true }).isDisabled(), true);
    const failed = (await calls()).filter(item => item.operation === 'uploadImage').at(-1); await editor.getByRole('button', { name: '重试', exact: true }).click(); await waitUploadedCover();
    assert.deepEqual((await calls()).filter(item => item.operation === 'uploadImage').at(-1).args, failed.args); assert.equal(await editor.getByRole('textbox', { name: '应用集名称' }).inputValue(), '网络失败草稿');
    assert.equal((await calls()).filter(item => item.operation === 'catalogAlbumEdit').length, before); assert.equal(await page.evaluate(() => window.__catalogMock.album.cover), original); await editor.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('cover verification keeps exact image payload and failed album save keeps the uploaded cover and draft', async () => {
    const editor = await openAlbumEditor(); const original = await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue(); await editor.getByRole('textbox', { name: '应用集名称' }).fill('验证保存草稿');
    await page.evaluate(() => { window.__catalogMock.uploadMode = 'VERIFY_REQUIRED'; }); await pickCover(editor); await editor.getByText('模拟封面安全验证', { exact: true }).waitFor();
    const failed = (await calls()).filter(item => item.operation === 'uploadImage').at(-1); assert.equal(await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue(), original); assert.equal(await editor.getByRole('button', { name: '保存应用集', exact: true }).isDisabled(), true);
    await editor.getByRole('button', { name: '完成验证', exact: true }).click(); await waitUploadedCover(); assert.deepEqual((await calls()).filter(item => item.operation === 'uploadImage').at(-1).args, failed.args);
    const uploaded = await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue(); assert.ok((await page.evaluate(() => window.__catalogMock.verifications)).includes('album-cover'));
    await page.evaluate(() => { window.__catalogMock.failOnce = 'catalogAlbumEdit'; }); await editor.getByRole('button', { name: '保存应用集', exact: true }).click(); await editor.getByText('模拟网络失败', { exact: true }).waitFor();
    assert.equal(await editor.getByRole('textbox', { name: '应用集名称' }).inputValue(), '验证保存草稿'); assert.equal(await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue(), uploaded); assert.equal(await page.evaluate(() => window.__catalogMock.album.cover), original);
    const saveAttempt = (await calls()).filter(item => item.operation === 'catalogAlbumEdit').at(-1); await editor.getByRole('button', { name: '重试', exact: true }).click(); await editor.waitFor({ state: 'hidden' }); assert.deepEqual((await calls()).filter(item => item.operation === 'catalogAlbumEdit').at(-1).args, saveAttempt.args);
  });
  await record('cancelling an in-flight cover or closing the editor rejects late uploads without losing the draft or saving', async () => {
    let editor = await openAlbumEditor(); const original = await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue(); const before = (await calls()).filter(item => item.operation === 'catalogAlbumEdit').length;
    await editor.getByRole('textbox', { name: '应用集名称' }).fill('取消上传草稿'); await page.evaluate(() => { window.__catalogMock.uploadMode = 'hold'; }); await pickCover(editor); await page.waitForFunction(() => window.__catalogMock.pending.some(item => item.operation === 'uploadImage'));
    await editor.getByRole('button', { name: '取消本次封面上传', exact: true }).click(); await page.evaluate(() => window.__catalogMock.pending.splice(0).forEach(item => item.resolve())); await settle();
    assert.equal(await editor.getByRole('textbox', { name: '应用集名称' }).inputValue(), '取消上传草稿'); assert.equal(await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue(), original); assert.equal(await editor.getByRole('button', { name: '保存应用集', exact: true }).isDisabled(), false);
    await page.evaluate(() => { window.__catalogMock.uploadMode = 'hold'; }); await pickCover(editor); await page.waitForFunction(() => window.__catalogMock.pending.some(item => item.operation === 'uploadImage')); await editor.getByRole('button', { name: '关闭', exact: true }).click();
    editor = await openAlbumEditor(); await page.evaluate(() => window.__catalogMock.pending.splice(0).forEach(item => item.resolve())); await settle(); assert.equal(await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue(), original); assert.equal((await calls()).filter(item => item.operation === 'catalogAlbumEdit').length, before); await editor.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('pending cover uploads cannot alter a different application collection or account', async () => {
    let editor = await openAlbumEditor(); const before = (await calls()).filter(item => item.operation === 'catalogAlbumEdit').length;
    await page.evaluate(() => { window.__catalogMock.uploadMode = 'hold'; }); await pickCover(editor); await page.waitForFunction(() => window.__catalogMock.pending.some(item => item.operation === 'uploadImage'));
    editor = await openAlbumEditor('8'); await page.evaluate(() => window.__catalogMock.pending.splice(0).forEach(item => item.resolve())); await settle();
    assert.equal(await editor.getByRole('textbox', { name: '应用集名称' }).inputValue(), '另一应用集'); assert.equal(await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue(), 'https://image.coolapk.com/album/another.png'); await editor.getByRole('button', { name: '关闭', exact: true }).click();
    editor = await openAlbumEditor(); const original = await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue(); await page.evaluate(() => { window.__catalogMock.uploadMode = 'hold'; }); await pickCover(editor); await page.waitForFunction(() => window.__catalogMock.pending.some(item => item.operation === 'uploadImage'));
    await page.evaluate(() => window.__catalogAccount('654321')); await editor.waitFor({ state: 'hidden' }); await page.evaluate(() => window.__catalogMock.pending.splice(0).forEach(item => item.resolve())); await settle(); assert.equal(await page.getByRole('button', { name: '编辑应用集', exact: true }).count(), 0);
    await page.evaluate(() => window.__catalogAccount('123456')); editor = await openAlbumEditor(); assert.equal(await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue(), original); assert.equal((await calls()).filter(item => item.operation === 'catalogAlbumEdit').length, before); await editor.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('cancelled cover verification cannot replay an abandoned upload after its verification window completes', async () => {
    const editor = await openAlbumEditor(); const original = await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue(); await editor.getByRole('textbox', { name: '应用集名称' }).fill('取消验证草稿');
    await page.evaluate(() => { window.__catalogMock.uploadMode = 'VERIFY_REQUIRED'; window.__catalogMock.holdVerification = true; }); await pickCover(editor); await editor.getByText('模拟封面安全验证', { exact: true }).waitFor(); const before = (await calls()).filter(item => item.operation === 'uploadImage').length;
    await editor.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => window.__catalogMock.pending.some(item => item.operation === 'verify'));
    await editor.getByRole('button', { name: '取消本次封面上传', exact: true }).click(); await page.evaluate(() => { window.__catalogMock.pending.splice(0).forEach(item => item.resolve()); window.__catalogMock.holdVerification = false; }); await settle();
    assert.equal((await calls()).filter(item => item.operation === 'uploadImage').length, before); assert.equal(await editor.getByRole('textbox', { name: '应用集封面', exact: true }).inputValue(), original); assert.equal(await editor.getByRole('textbox', { name: '应用集名称' }).inputValue(), '取消验证草稿'); assert.equal(await editor.getByRole('alert').count(), 0); await editor.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('official accounts and activity details can be browsed', async () => {
    await navigate('dyhs'); await page.getByRole('button', { name: /官方测试号/ }).click(); await page.getByRole('button', { name: '关注酷安号' }).click();
    assert.ok((await calls()).some(item => item.operation === 'catalogDyhFollow' && item.args.id === '3'));
    await page.locator('.feed-card').filter({ hasText: '酷安号文章正文' }).waitFor();
    await navigate('events'); await page.getByRole('button', { name: /摄影活动/ }).click(); await page.getByText('活动介绍', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '查看活动参与页面' }).count(), 1);
  });
  await record('missing application collection details are unavailable rather than an empty successful list', async () => {
    await page.evaluate(() => { window.__catalogMock.missingApps = true; }); await navigate('album', '7');
    await page.getByText('应用列表暂不可用', { exact: true }).waitFor(); assert.equal(await page.getByText('应用集还没有内容', { exact: true }).count(), 0);
    await page.evaluate(() => { window.__catalogMock.missingApps = false; });
  });
  await record('picture tags remain a read-only paginated gallery', async () => {
    await navigate('pictures'); await page.getByRole('textbox', { name: '酷图标签' }).fill('风景'); await page.getByRole('button', { name: '搜索', exact: true }).click();
    await page.locator('.catalog-gallery-item').waitFor(); assert.ok((await calls()).some(item => item.operation === 'catalogPictures' && item.args.tag === '风景'));
  });
  await record('guest catalog actions open login and issue no write operation', async () => {
    await page.evaluate(() => window.__catalogAccount('')); await navigate('product', '7');
    const before = (await calls()).filter(item => item.operation === 'catalogProductWish').length;
    await page.getByRole('button', { name: '想买', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__catalogMock.login), 1);
    assert.equal((await calls()).filter(item => item.operation === 'catalogProductWish').length, before);
  });
  assert.deepEqual(errors, []); await page.screenshot({ path: resolve(output, 'complete.png') });
  writeFileSync('research/catalog-ui-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'synthetic isolated renderer; external network blocked; no real account writes', checks, errors }, null, 2));
  writeFileSync('research/product-workflow-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'synthetic product workflows; external network blocked; local encoded WebM; no real account writes', checks: productChecks, errors, sources: [
    { path: '.local/reference/coolapk-desktop-main/src/pages/ProductPage.vue', lines: '543-547,723-746', fields: ['listType omitted for default', 'dateline_desc', 'rank_score'] },
    { path: '.local/reference/coolapk-desktop-main/src/utils/productRatingSort.ts', lines: '5-38', fields: ['top-level sortSelectCard.entities', 'title', 'same-product url', 'feed rows'] },
    { path: '.local/reference/coolapk-desktop-main/src/utils/__tests__/productRatingSort.test.ts', lines: '7-24', fields: ['type=rating', 'type=ratingByScore', 'isOwner=1', 'listType=dateline_desc'] },
    { path: '.local/reference/coolapk-desktop-main/src/pages/ProductPage.vue', lines: '785-796,1049-1076,1124-1176', fields: ['star_* and owner_star_*', 'recent_30_days_*', 'rating_item_info', 'ratingFeed and ratingFeedUrl', 'server sort descriptor and cursors'] },
    { path: '.local/reference/coolapk-desktop-main/src/pages/ProductPage.vue', lines: '937-1000,1012-1022', fields: ['media image/video/recommend', 'type', 'url', 'pic', 'media_info.cover_url/coverUrl/pic'] },
    { path: '.local/reference/coolapk-desktop-main/src/types/product.ts', lines: '34-49', fields: ['product media feed_id'] },
  ], remaining: ['cloud comparison list has no confirmed read contract', 'rating sort descriptors outside the explicitly confirmed schema are excluded'] }, null, 2));
  await context.close();
} catch (error) { const page = browser?.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: resolve(output, 'failure.png') }); console.log('FAILURE_STATE', await page.locator('body').innerText()); } throw error; }
finally { await browser?.close(); await server.close(); }
