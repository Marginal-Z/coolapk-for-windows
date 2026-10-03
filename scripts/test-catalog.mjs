import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const port = Number(process.env.COOLAPK_CATALOG_TEST_PORT || 5176), origin = `http://127.0.0.1:${port}`;
const output = resolve('.local/catalog-check'); mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'test.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
writeFileSync(resolve(output, 'entry.tsx'), `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import Catalog from '/src/Catalog.tsx';import'/src/styles.css';function Fixture(){const[page,setPage]=useState({kind:'catalog',type:'hub',title:'发现'});const[uid,setUid]=useState('123456');window.__catalogNavigate=(type,id,title)=>setPage({kind:'catalog',type,id,title:title||'界面测试'});window.__catalogAccount=(value)=>{window.__catalogMock.uid=value;setUid(value)};const account=uid?{uid,username:'模拟酷友',userAvatar:''}:null;const noop=()=>{};return <main style={{maxWidth:1000,margin:'auto',padding:30}}><Catalog page={page} namespace={uid||'guest'} account={account} go={setPage} onLogin={()=>window.__catalogMock.login++} openEntity={item=>window.__catalogMock.opened.push(item)} toast={noop} feedProps={{onOpen:noop,onUser:noop,onLink:noop,onLogin:noop,onForward:noop,loggedIn:!!account,accountUid:uid,toast:noop}}/></main>}createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
async function record(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__catalogMock = { calls: [], opened: [], login: 0, uid: '123456', pending: [], verifications: [], holdVerification: false, failSubtabMore: '', failCommentsMore: '', holdCommentSort: '', uploadMode: '', uploadCount: 0, delayRatingsStar: -1, emptyProductTabs: false, badVersions: false, album: { id: 7, uid: '123456', title: '工具箱', intro: '常用工具', cover: 'https://image.coolapk.com/album/original.png', apkList: [{ entityType: 'apk', packageName: 'com.example.one', title: '应用甲' }] }, failOnce: '' };
    const ok = data => ({ ok: true, data }), list = data => ({ data, hasMore: false });
    window.coolapk = { openExternal: async () => ok({}), verify: async id => { mock.verifications.push(id); if (mock.holdVerification) return new Promise(resolve => mock.pending.push({ operation: 'verify', resolve: () => resolve(ok({})) })); return ok({}); }, call: async (operation, args = {}) => {
      mock.calls.push({ operation, args: JSON.parse(JSON.stringify(operation === 'uploadImage' ? { ...args, bytes: Array.from(args.bytes) } : args)), uid: mock.uid });
      if (operation === mock.failOnce) { mock.failOnce = ''; return { ok: false, error: { code: 'NETWORK', message: '模拟网络失败' } }; }
      if (operation === 'catalogProductSubtab' && args.page === 2 && mock.failSubtabMore) { const code = mock.failSubtabMore; mock.failSubtabMore = ''; return { ok: false, error: { code, message: code === 'VERIFY_REQUIRED' ? '模拟第二页验证' : '模拟第二页网络失败', ...(code === 'VERIFY_REQUIRED' ? { verificationId: 'catalog-page2' } : {}) } }; }
      if (operation === 'search') return ok(list([{ entityType: 'product', id: 8, title: '另一款手机' }]));
      if (operation === 'catalogProduct') {
        const tab = (title, type, extra = '') => ({ title, url: '/page?url=' + encodeURIComponent(`/product/feedList?id=${args.id}&type=${type}${extra}`) });
        const tabList = mock.emptyProductTabs ? [] : [tab('讨论', 'feed'), { ...tab('样张板块', 'subTabFeed', '&subId=004'), page_name: '004' }, { ...tab('隐藏栏目', 'video'), is_open: '0' }, tab('点评栏目', 'rating'), tab('图文栏目', 'article'), { title: '鸿蒙栏目', page_name: 'diy9', url: '/topic/tagList?keywords=鸿蒙' }, { title: '异机栏目', url: '/product/feedList?id=999&type=feed' }, { title: '外站栏目', url: 'https://evil.test/product/feedList?id=' + args.id + '&type=feed' }, { title: '写入栏目', url: '/feed/deleteFeed?id=123' }, tab('重复讨论', 'feed')];
        return ok({ data: { id: args.id, title: args.id === '8' ? '另一款手机' : '测试手机', logo: '', configRows: [{ id: args.id === '8' ? 91 : 71, title: args.id === '8' ? '另一机型版本' : '12GB版本' }, { id: 72, title: '16GB版本' }], tabList, userAction: {} } });
      }
      if (operation === 'catalogProductFeeds') return ok(list([{ entityType: 'feed', id: 700, username: '模拟酷友', message: `产品${args.id}的${args.type}内容` }]));
      if (operation === 'catalogProductSubtab') return ok({ data: [{ entityType: 'feed', id: args.page === 2 ? 704 : 703, username: '模拟酷友', message: args.page === 2 ? '样张板块第二页' : '样张板块动态' }], firstItem: 'feed_703', lastItem: args.page === 2 ? 'feed_704' : 'feed_703', hasMore: args.page !== 2 });
      if (operation === 'catalogProductRatings') {
        const data = { data: [{ entityType: 'feed', id: 710 + Number(args.star), username: '评分酷友', message: args.star === mock.delayRatingsStar ? '过期评分结果' : `评分筛选 ${args.star || '全部'} 星${args.owner ? '拥有者' : '所有用户'}` }], firstItem: 'rating_first', lastItem: 'rating_last', hasMore: args.page !== 2 };
        if (args.star === mock.delayRatingsStar) return new Promise(resolve => mock.pending.push({ operation, args, resolve: () => resolve(ok(data)) }));
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
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductFeeds').at(-1).args, { id: '7', type: 'article' });
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
    assert.deepEqual((await calls()).filter(item => item.operation === 'catalogProductRatings').at(-1).args, { id: '8', star: 0, owner: false });
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
    const editor = page.getByRole('dialog', { name: '产品评分与点评' }); await editor.getByRole('textbox', { name: '产品点评' }).fill('模拟使用感受');
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
  await context.close();
} catch (error) { const page = browser?.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: resolve(output, 'failure.png') }); console.log('FAILURE_STATE', await page.locator('body').innerText()); } throw error; }
finally { await browser?.close(); await server.close(); }
