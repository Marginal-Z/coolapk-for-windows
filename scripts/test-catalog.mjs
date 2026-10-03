import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const port = Number(process.env.COOLAPK_CATALOG_TEST_PORT || 5176), origin = `http://127.0.0.1:${port}`;
const output = resolve('.local/catalog-check'); mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'test.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
writeFileSync(resolve(output, 'entry.tsx'), `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import Catalog from '/src/Catalog.tsx';import'/src/styles.css';function Fixture(){const[page,setPage]=useState({kind:'catalog',type:'hub',title:'发现'});const[uid,setUid]=useState('123456');window.__catalogNavigate=(type,id,title)=>setPage({kind:'catalog',type,id,title:title||'界面测试'});window.__catalogAccount=setUid;const account=uid?{uid,username:'模拟酷友',userAvatar:''}:null;const noop=()=>{};return <main style={{maxWidth:1000,margin:'auto',padding:30}}><Catalog key={uid+JSON.stringify(page)} page={page} namespace={uid||'guest'} account={account} go={setPage} onLogin={()=>window.__catalogMock.login++} openEntity={item=>window.__catalogMock.opened.push(item)} toast={noop} feedProps={{onOpen:noop,onUser:noop,onLink:noop,onLogin:noop,onForward:noop,loggedIn:!!account,accountUid:uid,toast:noop}}/></main>}createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
async function record(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__catalogMock = { calls: [], opened: [], login: 0, album: { id: 7, uid: '123456', title: '工具箱', intro: '常用工具', apkList: [{ entityType: 'apk', packageName: 'com.example.one', title: '应用甲' }] }, failOnce: '' };
    const ok = data => ({ ok: true, data }), list = data => ({ data, hasMore: false });
    window.coolapk = { openExternal: async () => ok({}), call: async (operation, args = {}) => {
      mock.calls.push({ operation, args: JSON.parse(JSON.stringify(args)) });
      if (operation === mock.failOnce) { mock.failOnce = ''; return { ok: false, error: { code: 'NETWORK', message: '模拟网络失败' } }; }
      if (operation === 'search') return ok(list([{ entityType: 'product', id: 8, title: '另一款手机' }]));
      if (operation === 'catalogProduct') return ok({ data: { id: args.id, title: args.id === '8' ? '另一款手机' : '测试手机', logo: '', configRows: [{ id: args.id === '8' ? 91 : 71, title: args.id === '8' ? '另一机型版本' : '12GB版本' }, { id: 72, title: '16GB版本' }], userAction: {} } });
      if (operation === 'catalogProductConfig') return ok({ data: { id: args.id, title: args.id === '91' ? '另一机型版本' : args.id === '71' ? '12GB版本' : '16GB版本', cpu: args.id === '91' ? '处理器乙' : '处理器甲', ram: args.id === '71' ? '12GB' : '16GB', config_data: JSON.stringify({ 屏幕: { 尺寸: '6.8英寸', 刷新率: '120Hz' } }) } });
      if (operation === 'catalogProductRatingChart') return ok({ data: Object.fromEntries(['day', 'week', 'month'].map(period => [period, { ratingChart: { x: [{ score: 4.1, count: 12, datelineStr: '测试周期' }] }, ownerRatingChart: { x: [{ score: 4.6, count: 8, datelineStr: '测试周期' }] } }])) });
      if (operation === 'catalogProductBrands' || operation === 'catalogProductCategories') return ok(list([{ id: 10, entityType: 'productCategory', title: '手机分类', url: '#/product/productList?category_id=10' }]));
      if (operation === 'catalogProductCategoryItems' || operation === 'catalogProductBrandItems') return ok(list([{ id: 7, entityType: 'product', title: '测试手机' }]));
      if (operation === 'catalogApp') return ok({ data: { id: 9, aid: 9, packageName: 'com.example.one', title: '应用甲', apkversion: '1.2.0', developer: '测试开发者', description: '<p>应用说明</p>', userAction: {} } });
      if (operation === 'catalogAppVersions') return ok(list([{ id: 3, title: '历史版本1.0' }]));
      if (operation === 'catalogAlbums' || operation === 'catalogMyAlbums' || operation === 'catalogAlbumSearch') return ok(list([mock.album]));
      if (operation === 'catalogAlbum') return ok({ data: mock.missingApps ? { ...mock.album, apkList: undefined, apkCount: 3 } : mock.album });
      if (operation === 'catalogAlbumCreate') return ok({ data: { id: 8, title: args.title } });
      if (operation === 'catalogAlbumEdit') { Object.assign(mock.album, { title: args.title, intro: args.intro }); return ok({ data: mock.album }); }
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
  await record('catalog discovery opens fixed product classification context', async () => {
    await page.getByRole('button', { name: /数码资料库/ }).click(); await page.getByRole('button', { name: /手机分类/ }).click();
    await page.getByRole('button', { name: /测试手机/ }).waitFor();
    assert.ok((await calls()).some(item => item.operation === 'catalogProductCategoryItems' && item.args.url === '#/product/productList?category_id=10'));
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
