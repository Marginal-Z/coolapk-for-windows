import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const port = Number(process.env.COOLAPK_GOODS_TEST_PORT || 5181), origin = `http://127.0.0.1:${port}`;
const output = resolve('.local/goods-check'); mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'test.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
writeFileSync(resolve(output, 'entry.tsx'), `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Goods from '/src/Goods.tsx';import'/src/styles.css';function Fixture(){const[page,setPage]=useState({kind:'goods',type:'hub',title:'好物'});const[uid,setUid]=useState('123456');window.__goodsNavigate=(type,id,owner)=>setPage({kind:'goods',type,id,uid:owner,title:'界面测试'});window.__goodsAccount=setUid;const account=uid?{uid,username:'模拟酷友',userAvatar:''}:null;const noop=()=>{};return <main data-goods-route={JSON.stringify({type:page.type||'hub',id:String(page.id||''),uid:String(page.uid||'')})} style={{maxWidth:1000,margin:'auto',padding:30}}><Goods page={page} namespace={uid||'guest'} account={account} go={setPage} onLogin={()=>window.__goodsMock.login++} openEntity={item=>window.__goodsMock.opened.push(item)} toast={message=>window.__goodsMock.toasts.push(message)} feedProps={{onOpen:item=>window.__goodsMock.opened.push(item),onUser:noop,onLink:noop,onLogin:noop,onForward:noop,onManage:item=>window.__goodsMock.managed.push(item),loggedIn:!!account,accountUid:uid,toast:noop}}/></main>}createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
async function record(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const feed = { id: 101, uid: '123456', username: '模拟酷友', goodsListInfo: { id: 707, title: '通勤清单', message: '每日携带', cover: 'https://image.coolapk.com/feed/list.jpg', list_type: 'feed', is_open_vote: 1, top_limit: 3, vote_num: 7, item_num: 1 }, goodsListItem: [{ id: 11, feed_id: 555, product_goods_id: 88, product_goods_title: '测试耳机', product_goods_cover: 'https://market.example.test/original.jpg', note: '轻便好带', vote_num: 7, isVote: 0 }] };
    const mock = window.__goodsMock = { feed, calls: [], login: 0, opened: [], managed: [], toasts: [], failOnce: '', rejectOnce: '', missingItems: false, verifies: [], album: { id: 22, uid: '123456', title: '数码专辑', description: '常用装备', album_type: 1, canEdit: true, canDelete: true, enableModify: 1, productItems: [{ id: '2200', level: '1', item_id: '99', item_name: '测试手机', item_description: '备用设备' }] } };
    const ok = data => ({ ok: true, data }), list = data => ({ data, hasMore: false }), copy = value => JSON.parse(JSON.stringify(value));
    window.coolapk = { verify: async id => { mock.verifies.push(id); if (mock.waitVerify) return new Promise(resolve => { mock.resolveVerify = () => resolve(ok({})); }); return ok({}); }, openExternal: async url => { mock.opened.push(url); return ok({}); }, call: async (operation, args = {}) => {
      mock.calls.push({ operation, args: copy(args) });
      if (operation === mock.failOnce) { mock.failOnce = ''; return { ok: false, error: { code: 'VERIFY_REQUIRED', message: '模拟验证码', verificationId: 'synthetic-goods-verification' } }; }
      if (operation === mock.rejectOnce) { mock.rejectOnce = ''; return { ok: false, error: { code: 'CONFLICT', message: '清单项目已在其它设备变化，请刷新后重新编辑' } }; }
      if (operation === mock.uncertainOnce) { mock.uncertainOnce = ''; return { ok: false, error: { code: 'WRITE_UNCONFIRMED', message: '提交结果尚未确认，请先查看我的清单核对，避免重复创建' } }; }
      if (operation === 'goodsSearch' && args.keyword === '分页商品') {
        if (args.page === 2 && mock.failGoodsMore) { mock.failGoodsMore = false; return { ok: false, error: { code: 'VERIFY_REQUIRED', message: '模拟商品第二页验证', verificationId: 'synthetic-goods-page2' } }; }
        return ok({ data: [{ id: args.page === 2 ? 89 : 88, goods_title: args.page === 2 ? '分页商品第二页' : '分页商品第一页', goods_price: '199' }], firstItem: 'goods_first', lastItem: args.page === 2 ? 'goods_next' : 'goods_first', hasMore: args.page !== 2 });
      }
      if (operation === 'goodsHotWords') return ok(list([{ id: 'word_0', title: '耳机' }]));
      if (operation === 'goodsSearch') return ok(list([{ id: 88, goods_title: '测试耳机', goods_price: '199', goods_pic: 'https://market.example.test/original.jpg' }, { id: 89, goods_title: '测试充电器', goods_price: '99' }]));
      if (operation === 'goodsPrepare') return ok({ data: '90', createdId: '90' });
      if (operation === 'goodsDetail') return ok({ data: { id: args.id, goods_title: '测试耳机', goods_price: '199', description: '无线耳机说明', goods_buy_url: 'https://shop.example.test/item/88' } });
      if (operation === 'goodsListTypes') return ok(list([{ id: 'feed', title: '默认分类' }, { id: 'tech', title: '数码用品' }]));
      if (operation === 'goodsLists') return ok(list([copy(feed), { id: 102, uid: '987654', goodsListInfo: { id: 708, title: '另一张清单', is_open_vote: 0, list_type: 'tech', item_num: 2 } }]));
      if (operation === 'goodsListFeed') return ok({ data: { ...copy(feed), ...(mock.missingItems ? { goodsListItem: undefined } : {}) } });
      if (operation === 'goodsListCreate') return ok({ data: { id: 103 }, createdId: '103' });
      if (operation === 'goodsListEdit') { Object.assign(feed.goodsListInfo, { title: args.title, message: args.message, cover: args.cover, list_type: args.listType, top_limit: args.topLimit, is_open_vote: args.isOpenVote ? 1 : 0 }); return ok({ data: {} }); }
      if (operation === 'goodsItemAdd') { feed.goodsListItem.push({ id: 12, feed_id: 556, product_goods_id: Number(args.goodsId), product_goods_title: args.goodsId === '90' ? '转换后的商品' : '测试充电器', note: args.note, isVote: 0 }); return ok({ data: {} }); }
      if (operation === 'goodsItemEdit') { feed.goodsListItem.find(item => String(item.id) === args.itemId).note = args.note; return ok({ data: {} }); }
      if (operation === 'goodsItemVote') { feed.goodsListItem.find(item => String(item.id) === args.itemId).isVote = args.value === 1 ? 1 : 0; return ok({ data: {} }); }
      if (operation === 'goodsItemRemove') { feed.goodsListItem = feed.goodsListItem.filter(item => String(item.id) !== args.itemId); return ok({ data: {} }); }
      if (operation === 'goodsListBind') return ok({ data: {} });
      if (operation === 'userFeeds') return ok(list([{ id: 909, uid: '123456', message: '我的已发布动态' }]));
      if (operation === 'replies') return ok(list([{ id: 201, username: '模拟评论者', message: '评论自己的独立 ID' }]));
      if (operation === 'goodsMyFeeds') return ok(list([{ id: 30, entityType: 'feed', uid: '123456', username: '模拟酷友', message: '我的好物动态' }]));
      if (operation === 'goodsStore') return ok(list([{ id: 31, entityType: 'goods', goods_title: '店铺商品' }]));
      if (operation === 'goodsAlbums') return ok(list(mock.albumDeleted ? [] : [copy(mock.album)]));
      if (operation === 'goodsAlbum') { const album = copy(mock.album); if (mock.holdAlbumRead) await new Promise(resolve => { (mock.pendingAlbumReads ||= []).push(() => resolve()); }); mock.albumReadsCompleted = (mock.albumReadsCompleted || 0) + 1; return ok({ data: album }); }
      if (operation === 'goodsAlbumCreate') { mock.albumDeleted = false; mock.album = { id: 23, uid: '123456', title: args.title, description: args.description, album_type: args.albumType, canEdit: true, canDelete: true, enableModify: 1, productItems: copy(args.items).map((item, index) => ({ ...item, id: String(2300 + index) })) }; return ok({ data: { id: 23 }, createdId: '23' }); }
      if (operation === 'goodsAlbumEdit') { Object.assign(mock.album, { title: args.title, description: args.description, productItems: copy(args.items).map((item, index) => ({ ...item, id: item.id || String(3300 + index) })) }); return ok({ data: { id: mock.album.id }, createdId: String(mock.album.id) }); }
      if (operation === 'goodsAlbumDelete') { mock.albumDeleted = true; return ok({ data: 1 }); }
      if (operation === 'search') return ok(list([{ id: 99, entityType: 'product', title: '测试手机', description: '产品说明' }]));
      if (operation === 'uploadImage') return ok({ data: 'https://image.coolapk.com/feed/uploaded-cover.png' });
      return ok(list([]));
    } };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/.local/goods-check/test.html`);
  await page.getByRole('button', { name: /找好物/ }).waitFor();
  async function navigate(type, id, uid) {
    const before = type === 'album' ? (await writes('goodsAlbum')).length : 0;
    await page.evaluate(value => window.__goodsNavigate(value.type, value.id, value.uid), { type, id, uid });
    // setPage returning does not establish a React commit. Without this boundary,
    // hub -> the same album can be batched into one render and never reread data.
    await page.waitForFunction(route => document.querySelector('main')?.dataset.goodsRoute === route, JSON.stringify({ type, id: String(id || ''), uid: String(uid || '') }));
    if (type === 'album') await page.waitForFunction(before => window.__goodsMock.calls.filter(item => item.operation === 'goodsAlbum').length > before, before);
  }
  const calls = () => page.evaluate(() => window.__goodsMock.calls);
  const writes = async operation => (await calls()).filter(item => item.operation === operation);
  async function listDetail() { await navigate('list', '101'); await page.getByRole('button', { name: '编辑清单', exact: true }).waitFor(); }

  await record('goods search preserves keyword, exact sorting and coupon filtering', async () => {
    await page.getByRole('button', { name: /找好物/ }).click(); await page.getByRole('button', { name: '耳机', exact: true }).click();
    await page.getByRole('button', { name: /测试耳机/ }).waitFor(); await page.getByRole('combobox', { name: '商品排序' }).selectOption('price_desc');
    await page.getByRole('checkbox', { name: '只看优惠券商品' }).check();
    await page.waitForFunction(() => window.__goodsMock.calls.some(item => item.operation === 'goodsSearch' && item.args.sort === 'price_desc' && item.args.coupon));
    await navigate('hub'); await navigate('search'); await page.getByText('最近搜索', { exact: true }).waitFor();
    await page.getByRole('button', { name: '清空搜索记录' }).click(); assert.equal(await page.getByText('最近搜索', { exact: true }).count(), 0);
  });
  await record('goods detail uses explicit external shopping navigation', async () => {
    await navigate('detail', '88'); await page.getByText('无线耳机说明', { exact: true }).waitFor(); await page.getByRole('button', { name: '查看商城商品' }).click();
    assert.ok(await page.evaluate(() => window.__goodsMock.opened.includes('https://shop.example.test/item/88')));
  });
  await record('goods search second-page verification retries the same filters and cursors without clearing results', async () => {
    await navigate('search'); await page.getByRole('textbox', { name: '搜索好物', exact: true }).fill('分页商品'); await page.getByRole('button', { name: '搜索商品', exact: true }).click();
    await page.getByRole('button', { name: /分页商品第一页/ }).waitFor(); await page.evaluate(() => { window.__goodsMock.failGoodsMore = true; }); await page.getByRole('button', { name: '加载更多', exact: true }).click();
    await page.getByText('模拟商品第二页验证', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: /分页商品第一页/ }).count(), 1);
    await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.getByRole('button', { name: /分页商品第二页/ }).waitFor();
    const requested = (await calls()).filter(item => item.operation === 'goodsSearch' && item.args.keyword === '分页商品');
    assert.deepEqual(requested.map(item => item.args.page || 1), [1, 2, 2]); assert.deepEqual(requested[2].args, requested[1].args);
    assert.ok(await page.evaluate(() => window.__goodsMock.verifies.includes('synthetic-goods-page2'))); assert.equal(await page.getByRole('button', { name: /分页商品第一页/ }).count(), 1);
  });
  await record('list creation sends category, top limit, vote setting and confirmed returned id', async () => {
    await navigate('ranking'); await page.getByRole('button', { name: '创建好物榜', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '创建好物清单' });
    await dialog.getByRole('textbox', { name: '清单标题' }).fill('新推荐榜'); await dialog.getByRole('textbox', { name: '清单说明' }).fill('模拟说明');
    await dialog.getByRole('combobox', { name: '清单分类' }).selectOption('tech'); await dialog.getByRole('spinbutton', { name: '清单置顶数量' }).fill('5');
    await dialog.getByRole('button', { name: '保存清单' }).click(); await dialog.waitFor({ state: 'hidden' });
    const created = (await writes('goodsListCreate')).at(-1); assert.equal(created.args.title, '新推荐榜'); assert.equal(created.args.isOpenVote, true); assert.equal(created.args.listType, 'tech'); assert.equal(created.args.topLimit, 5);
  });
  await record('list edits anchor to parent feed and preserve original cover', async () => {
    await listDetail(); await page.getByRole('button', { name: '编辑清单', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '编辑好物清单' });
    await dialog.getByRole('textbox', { name: '清单标题' }).fill('通勤推荐清单'); await dialog.getByRole('button', { name: '保存清单' }).click(); await dialog.waitFor({ state: 'hidden' });
    const edit = (await writes('goodsListEdit')).at(-1); assert.equal(edit.args.id, '101'); assert.equal(edit.args.cover, 'https://image.coolapk.com/feed/list.jpg');
  });
  await record('cover upload stays blocked through verification and applies only confirmed official image', async () => {
    await page.getByRole('button', { name: '编辑清单', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '编辑好物清单' });
    const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4; canvas.getContext('2d').fillRect(0, 0, 4, 4); return canvas.toDataURL().split(',')[1]; });
    await page.evaluate(() => { window.__goodsMock.failOnce = 'uploadImage'; });
    await dialog.getByLabel('上传封面图片', { exact: true }).setInputFiles({ name: 'synthetic-cover.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await dialog.getByRole('button', { name: '完成验证' }).waitFor(); assert.equal(await dialog.getByRole('button', { name: '保存清单' }).isDisabled(), true);
    await dialog.getByRole('button', { name: '完成验证' }).click(); await dialog.getByRole('textbox', { name: '封面图片地址' }).waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="封面图片地址"]')?.value === 'https://image.coolapk.com/feed/uploaded-cover.png');
    await dialog.getByRole('button', { name: '保存清单' }).click(); await dialog.waitFor({ state: 'hidden' });
    const uploads = await writes('uploadImage'); assert.equal(uploads.length, 2); assert.deepEqual(uploads[0].args, uploads[1].args); assert.equal((await writes('goodsListEdit')).at(-1).args.cover, 'https://image.coolapk.com/feed/uploaded-cover.png');
  });
  await record('add product picker keeps marketplace images out of upload form', async () => {
    await page.getByRole('button', { name: '添加商品', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '添加商品到清单' });
    await dialog.getByRole('textbox', { name: '搜索好物' }).fill('充电器'); await dialog.getByRole('button', { name: '搜索商品' }).click(); await dialog.getByRole('button', { name: /测试充电器/ }).click(); await dialog.waitFor({ state: 'hidden' });
    const added = (await writes('goodsItemAdd')).at(-1); assert.deepEqual(added.args, { id: '101', goodsId: '89', note: '', pic: '' });
  });
  await record('recommend and cancel use distinct one and minus-one votes', async () => {
    const row = page.locator('.goods-item').filter({ hasText: '测试耳机' }); await row.getByRole('button', { name: /^推荐 ·/ }).click(); await row.getByRole('button', { name: /^取消推荐 ·/ }).click(); await row.getByRole('button', { name: /^推荐 ·/ }).waitFor();
    const votes = await writes('goodsItemVote'); assert.deepEqual(votes.map(item => item.args.value), [1, -1]); assert.equal(votes[0].args.id, '101'); assert.equal(votes[0].args.itemId, '11'); assert.equal(votes[0].args.goodsId, '88');
  });
  await record('item note verification retries the same frozen operation and preserves image metadata', async () => {
    await page.evaluate(() => { window.__goodsMock.failOnce = 'goodsItemEdit'; });
    await page.locator('.goods-item').filter({ hasText: '测试耳机' }).getByRole('button', { name: '编辑推荐理由' }).click(); const dialog = page.getByRole('dialog', { name: '编辑推荐理由' });
    await dialog.getByRole('textbox', { name: '推荐理由', exact: true }).fill('新的推荐理由'); await dialog.getByRole('button', { name: '保存推荐理由' }).click();
    await dialog.getByText('酷安要求安全验证', { exact: true }).waitFor(); assert.equal(await dialog.getByRole('textbox', { name: '推荐理由', exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click(); assert.equal(await dialog.count(), 1);
    await dialog.getByRole('button', { name: '完成验证' }).click(); await dialog.waitFor({ state: 'hidden' });
    const edits = await writes('goodsItemEdit'); assert.equal(edits.length, 2); assert.deepEqual(edits[0].args, edits[1].args); assert.equal(edits[0].args.pic, 'https://market.example.test/original.jpg'); assert.equal(edits[1].args.note, '新的推荐理由');
  });
  await record('remove requires confirmation and cancellation issues no write', async () => {
    const row = page.locator('.goods-item').filter({ hasText: '测试充电器' }); await row.getByRole('button', { name: '移除商品', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '移除清单商品' }); await dialog.getByRole('button', { name: '关闭', exact: true }).click(); assert.equal((await writes('goodsItemRemove')).length, 0);
    await row.getByRole('button', { name: '移除商品', exact: true }).click(); dialog = page.getByRole('dialog', { name: '移除清单商品' }); await dialog.getByRole('button', { name: '确认移除商品' }).click(); await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual((await writes('goodsItemRemove'))[0].args, { id: '101', itemId: '12', goodsId: '89' });
  });
  await record('bind existing owned feed and route full comments through parent feed', async () => {
    await page.getByRole('button', { name: '绑定我的动态', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '绑定我的动态' }); await dialog.getByRole('button', { name: '我的已发布动态' }).click(); await dialog.getByRole('button', { name: '确认绑定动态' }).click(); await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual((await writes('goodsListBind'))[0].args, { id: '101', feedId: '909' });
    await page.getByRole('tab', { name: '评论', exact: true }).click(); await page.getByText('评论自己的独立 ID', { exact: true }).waitFor(); assert.equal(await page.locator('.feed-card').count(), 0);
    await page.getByRole('button', { name: '查看并参与完整评论' }).click(); assert.equal(await page.evaluate(() => window.__goodsMock.opened.at(-1).id), 101);
  });
  await record('my goods switches known wish, purchased, store and album sources', async () => {
    await navigate('my'); await page.getByRole('tab', { name: '想买', exact: true }).click(); await page.getByText('我的好物动态', { exact: true }).waitFor(); await page.getByRole('tab', { name: '买过', exact: true }).click(); await page.getByRole('tab', { name: '商品店铺', exact: true }).click(); await page.getByRole('button', { name: /店铺商品/ }).waitFor(); await page.getByRole('tab', { name: '产品专辑', exact: true }).click(); await page.getByRole('button', { name: /数码专辑/ }).waitFor();
    assert.ok((await calls()).some(item => item.operation === 'goodsMyFeeds' && item.args.type === 'wish')); assert.ok((await calls()).some(item => item.operation === 'goodsMyFeeds' && item.args.type === 'buy')); assert.ok((await calls()).some(item => item.operation === 'goodsStore' && item.args.uid === '123456'));
  });
  await record('product album supports custom items, order, removal and product association', async () => {
    await navigate('albums'); await page.getByRole('button', { name: '创建产品专辑', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '创建产品专辑' });
    await dialog.getByRole('textbox', { name: '产品专辑标题' }).fill('整理后的装备'); await dialog.getByRole('textbox', { name: '项目 1 名称', exact: true }).fill('项目甲'); await dialog.getByRole('textbox', { name: '项目 1 配图地址', exact: true }).fill('https://image.coolapk.com/feed/project-image.jpg'); await dialog.getByRole('button', { name: '添加自定义项目' }).click(); await dialog.getByRole('textbox', { name: '项目 2 名称', exact: true }).fill('项目乙'); await dialog.getByRole('textbox', { name: '项目 2 配图地址', exact: true }).fill('https://image.coolapk.com/feed/project-image-2.jpg'); await dialog.getByRole('button', { name: '上移项目 2' }).click();
    assert.equal(await dialog.getByRole('textbox', { name: '项目 1 名称', exact: true }).inputValue(), '项目乙'); await dialog.getByRole('button', { name: '移除项目 2' }).click(); await dialog.getByRole('button', { name: '搜索关联产品' }).click();
    await dialog.getByRole('textbox', { name: '搜索专辑产品' }).fill('手机'); await dialog.getByRole('button', { name: '查找产品' }).click(); await dialog.getByRole('button', { name: /测试手机/ }).click(); await dialog.getByRole('button', { name: '创建专辑', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    const album = (await writes('goodsAlbumCreate'))[0]; assert.deepEqual(album.args.items.map(item => item.item_name), ['项目乙', '测试手机']); assert.equal(album.args.items[1].item_id, '99'); assert.equal(album.args.items[0].item_images, 'https://image.coolapk.com/feed/project-image-2.jpg');
    await page.getByRole('heading', { name: '整理后的装备', exact: true }).waitFor(); assert.equal(album.args.albumType, 1); assert.equal(await page.getByRole('button', { name: '编辑产品专辑', exact: true }).count(), 1); assert.equal(await page.getByRole('button', { name: '删除产品专辑', exact: true }).count(), 1);
  });
  await record('published album edits preserve item IDs, association and snapshot through frozen verification', async () => {
    await page.getByRole('button', { name: '编辑产品专辑', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '编辑产品专辑' });
    assert.equal(await dialog.getByRole('combobox', { name: '产品专辑类型' }).isDisabled(), true); assert.equal(await dialog.getByRole('textbox', { name: '项目 1 配图地址', exact: true }).inputValue(), 'https://image.coolapk.com/feed/project-image-2.jpg');
    assert.equal(await dialog.getByRole('textbox', { name: '项目 2 名称', exact: true }).isDisabled(), true); await dialog.getByRole('textbox', { name: '产品专辑标题' }).fill('已修改的装备'); await dialog.getByRole('textbox', { name: '产品专辑说明' }).fill('修改说明'); await dialog.getByRole('button', { name: '上移项目 2' }).click(); assert.equal(await dialog.getByRole('textbox', { name: '项目 1 名称', exact: true }).inputValue(), '测试手机');
    await dialog.getByRole('button', { name: '移除项目 2' }).click(); await dialog.getByRole('button', { name: '添加自定义项目' }).click(); await dialog.getByRole('textbox', { name: '项目 2 名称', exact: true }).fill('新增配件');
    await page.evaluate(() => { window.__goodsMock.failOnce = 'goodsAlbumEdit'; }); await dialog.getByRole('button', { name: '保存专辑修改', exact: true }).click(); await dialog.getByRole('button', { name: '完成验证' }).waitFor();
    assert.equal(await dialog.getByRole('textbox', { name: '产品专辑标题' }).isDisabled(), true); assert.equal(await dialog.getByRole('button', { name: '添加自定义项目' }).isDisabled(), true); await dialog.getByRole('button', { name: '关闭', exact: true }).click(); assert.equal(await dialog.count(), 1);
    await dialog.getByRole('button', { name: '完成验证' }).click(); await dialog.waitFor({ state: 'hidden' }); await page.getByRole('heading', { name: '已修改的装备', exact: true }).waitFor();
    const edits = await writes('goodsAlbumEdit'); assert.equal(edits.length, 2); assert.deepEqual(edits[0].args, edits[1].args); assert.deepEqual(edits[0].args.expectedItemIds, ['2300', '2301']); assert.equal(edits[0].args.id, '23'); assert.equal(edits[0].args.items[0].id, '2301'); assert.equal(edits[0].args.items[0].item_id, '99'); assert.equal(edits[0].args.items[1].id, ''); assert.equal('albumType' in edits[0].args, false);
  });
  await record('published ladder album renders and edits verified levels while failures retain the draft', async () => {
    // Deliberately leave an ordinary-album read in flight, then remount the same
    // id as a ladder. The fresh read must render NPC; the old read cannot replace it.
    await navigate('hub'); await page.evaluate(() => { window.__goodsMock.holdAlbumRead = true; }); await navigate('album', '23', '123456'); await page.waitForFunction(() => window.__goodsMock.pendingAlbumReads?.length > 0);
    await page.evaluate(() => { window.__goodsMock.album.album_type = 2; window.__goodsMock.album.productItems[0].level = '4'; window.__goodsMock.holdAlbumRead = false; }); await navigate('hub'); await navigate('album', '23', '123456'); await page.getByText('NPC', { exact: true }).waitFor();
    const beforeOldReads = await page.evaluate(() => window.__goodsMock.albumReadsCompleted); await page.evaluate(() => { window.__goodsMock.pendingAlbumReads.splice(0).forEach(resolve => resolve()); }); await page.waitForFunction(before => window.__goodsMock.albumReadsCompleted > before, beforeOldReads); assert.equal(await page.getByText('NPC', { exact: true }).count(), 1);
    await page.getByRole('button', { name: '编辑产品专辑', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '编辑产品专辑' }); assert.equal(await dialog.getByRole('combobox', { name: '项目 1 级别' }).inputValue(), '4'); await dialog.getByRole('combobox', { name: '项目 1 级别' }).selectOption('2'); await dialog.getByRole('textbox', { name: '产品专辑标题' }).fill('天梯编辑草稿');
    await page.evaluate(() => { window.__goodsMock.rejectOnce = 'goodsAlbumEdit'; }); await dialog.getByRole('button', { name: '保存专辑修改' }).click(); await dialog.getByText('清单项目已在其它设备变化，请刷新后重新编辑', { exact: true }).waitFor(); assert.equal(await dialog.getByRole('textbox', { name: '产品专辑标题' }).inputValue(), '天梯编辑草稿'); assert.equal(await dialog.getByRole('combobox', { name: '项目 1 级别' }).inputValue(), '2'); await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('album controls reflect owner, exhausted permissions, review and unavailable details', async () => {
    const reload = async () => { await navigate('hub'); await navigate('album', '23'); };
    await page.evaluate(() => { Object.assign(window.__goodsMock.album, { canEdit: false, enableModify: -1 }); }); await reload(); await page.getByText('此清单编辑次数已用尽', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '编辑产品专辑', exact: true }).count(), 0);
    await page.evaluate(() => { Object.assign(window.__goodsMock.album, { enableModify: 0, status: -5 }); }); await reload(); await page.getByText('此清单正在审核中，暂时不能编辑', { exact: true }).waitFor();
    await page.evaluate(() => { Object.assign(window.__goodsMock.album, { uid: '987654', canEdit: true, canDelete: true, enableModify: 1, status: 1 }); }); await reload(); await page.getByRole('heading', { name: '已修改的装备', exact: true }).waitFor(); await page.getByRole('button', { name: '删除产品专辑', exact: true }).waitFor({ state: 'hidden' }); assert.equal(await page.getByRole('button', { name: '编辑产品专辑', exact: true }).count(), 0); assert.equal(await page.getByRole('button', { name: '删除产品专辑', exact: true }).count(), 0);
    await page.evaluate(() => { Object.assign(window.__goodsMock.album, { uid: '123456', canEdit: false }); window.__goodsMock.savedAlbumItems = window.__goodsMock.album.productItems; delete window.__goodsMock.album.productItems; }); await reload(); await page.getByText('专辑项目明细暂不可用', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '编辑产品专辑', exact: true }).count(), 0); await page.evaluate(() => { Object.assign(window.__goodsMock.album, { productItems: window.__goodsMock.savedAlbumItems, canEdit: true }); });
  });
  await record('account change during album verification discards draft and prevents cross-account retry', async () => {
    await navigate('hub'); await navigate('album', '23'); await page.getByRole('button', { name: '编辑产品专辑', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '编辑产品专辑' });
    await dialog.getByRole('textbox', { name: '产品专辑标题' }).fill('切换前的草稿'); await page.evaluate(() => { window.__goodsMock.failOnce = 'goodsAlbumEdit'; window.__goodsMock.waitVerify = true; }); await dialog.getByRole('button', { name: '保存专辑修改' }).click(); await dialog.getByRole('button', { name: '完成验证' }).click(); await page.waitForFunction(() => !!window.__goodsMock.resolveVerify);
    const before = (await writes('goodsAlbumEdit')).length; await page.evaluate(() => window.__goodsAccount('654321')); await dialog.waitFor({ state: 'hidden' }); await page.evaluate(() => { window.__goodsMock.waitVerify = false; window.__goodsMock.resolveVerify(); }); await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50))); assert.equal((await writes('goodsAlbumEdit')).length, before); assert.equal(await page.getByRole('button', { name: '编辑产品专辑', exact: true }).count(), 0);
    await page.evaluate(() => window.__goodsAccount('123456')); await page.getByRole('button', { name: '编辑产品专辑', exact: true }).waitFor();
  });
  await record('album deletion requires confirmation and retains identical id through verification', async () => {
    await page.getByRole('button', { name: '删除产品专辑', exact: true }).click(); let dialog = page.getByRole('dialog', { name: '删除产品专辑' }); await dialog.getByRole('button', { name: '关闭', exact: true }).click(); assert.equal((await writes('goodsAlbumDelete')).length, 0);
    await page.getByRole('button', { name: '删除产品专辑', exact: true }).click(); dialog = page.getByRole('dialog', { name: '删除产品专辑' }); await page.evaluate(() => { window.__goodsMock.failOnce = 'goodsAlbumDelete'; }); await dialog.getByRole('button', { name: '确认删除产品专辑' }).click(); await dialog.getByRole('button', { name: '完成验证' }).waitFor(); assert.equal(await dialog.getByRole('button', { name: '确认删除产品专辑' }).isDisabled(), true); await dialog.getByRole('button', { name: '关闭', exact: true }).click(); assert.equal(await dialog.count(), 1); await dialog.getByRole('button', { name: '完成验证' }).click(); await dialog.waitFor({ state: 'hidden' }); await page.getByRole('button', { name: '创建产品专辑', exact: true }).waitFor();
    const deleted = await writes('goodsAlbumDelete'); assert.equal(deleted.length, 2); assert.deepEqual(deleted[0].args, { id: '23' }); assert.deepEqual(deleted[1].args, deleted[0].args); assert.equal(await page.getByRole('button', { name: /已修改的装备/ }).count(), 0);
  });
  await record('unconfirmed goods list creation retains its draft and blocks resubmission while cancel remains usable', async () => {
    await navigate('lists'); await page.getByRole('button', { name: '创建好物清单', exact: true }).click(); let dialog = page.getByRole('dialog', { name: '创建好物清单' });
    await dialog.getByRole('textbox', { name: '清单标题' }).fill('待核对清单'); await dialog.getByRole('textbox', { name: '清单说明' }).fill('保留完整说明'); const before = (await writes('goodsListCreate')).length;
    await page.evaluate(() => { window.__goodsMock.uncertainOnce = 'goodsListCreate'; }); await dialog.getByRole('button', { name: '保存清单' }).click(); await dialog.getByText('提交结果尚未确认，草稿已保留。请先去我的清单核对是否已创建，再决定下一步。', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('textbox', { name: '清单标题' }).inputValue(), '待核对清单'); assert.equal(await dialog.getByRole('textbox', { name: '清单说明' }).inputValue(), '保留完整说明'); assert.equal(await dialog.getByRole('button', { name: '保存清单' }).isDisabled(), true); assert.equal(await dialog.getByRole('button', { name: '重试', exact: true }).count(), 0);
    await dialog.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); assert.equal((await writes('goodsListCreate')).length, before + 1);
    await dialog.getByRole('button', { name: '取消创建', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); await page.getByRole('button', { name: '创建好物清单', exact: true }).click(); dialog = page.getByRole('dialog', { name: '创建好物清单' }); assert.equal(await dialog.getByRole('textbox', { name: '清单标题' }).inputValue(), ''); await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('unconfirmed product album creation keeps its items and opens the authenticated personal list without replay', async () => {
    await navigate('albums'); await page.getByRole('button', { name: '创建产品专辑', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '创建产品专辑' });
    await dialog.getByRole('textbox', { name: '产品专辑标题' }).fill('待核对装备'); await dialog.getByRole('textbox', { name: '产品专辑说明' }).fill('结果不明仍保留'); await dialog.getByRole('textbox', { name: '项目 1 名称', exact: true }).fill('测试相机'); await dialog.getByRole('textbox', { name: '项目 1 推荐理由', exact: true }).fill('随身装备');
    const before = (await writes('goodsAlbumCreate')).length, readsBefore = (await writes('goodsAlbums')).length; await page.evaluate(() => { window.__goodsMock.uncertainOnce = 'goodsAlbumCreate'; }); await dialog.getByRole('button', { name: '创建专辑', exact: true }).click(); await dialog.getByRole('button', { name: '核对我的产品清单', exact: true }).waitFor();
    assert.equal(await dialog.getByRole('textbox', { name: '产品专辑标题' }).inputValue(), '待核对装备'); assert.equal(await dialog.getByRole('textbox', { name: '产品专辑说明' }).inputValue(), '结果不明仍保留'); assert.equal(await dialog.getByRole('textbox', { name: '项目 1 名称', exact: true }).inputValue(), '测试相机'); assert.equal(await dialog.getByRole('textbox', { name: '项目 1 推荐理由', exact: true }).inputValue(), '随身装备'); assert.equal(await dialog.getByRole('button', { name: '创建专辑', exact: true }).isDisabled(), true); assert.equal(await dialog.getByRole('button', { name: '重试', exact: true }).count(), 0);
    await dialog.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); assert.equal((await writes('goodsAlbumCreate')).length, before + 1); await dialog.getByRole('button', { name: '核对我的产品清单', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(count => window.__goodsMock.calls.filter(item => item.operation === 'goodsAlbums').length > count, readsBefore); assert.equal((await writes('goodsAlbums')).at(-1).args.uid, '123456'); assert.equal((await writes('goodsAlbumCreate')).length, before + 1);
    await page.getByRole('button', { name: '创建产品专辑', exact: true }).click(); const fresh = page.getByRole('dialog', { name: '创建产品专辑' }); assert.equal(await fresh.getByRole('textbox', { name: '产品专辑标题' }).inputValue(), ''); await fresh.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('a confirmed creation captcha retries its original draft after verification', async () => {
    await navigate('lists'); await page.getByRole('button', { name: '创建好物清单', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '创建好物清单' }); await dialog.getByRole('textbox', { name: '清单标题' }).fill('验证码清单'); await dialog.getByRole('textbox', { name: '清单说明' }).fill('验证后才提交');
    const before = (await writes('goodsListCreate')).length; await page.evaluate(() => { window.__goodsMock.failOnce = 'goodsListCreate'; }); await dialog.getByRole('button', { name: '保存清单' }).click(); await dialog.getByRole('button', { name: '完成验证', exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '保存清单' }).isDisabled(), true); assert.equal(await dialog.getByRole('button', { name: '取消创建', exact: true }).count(), 0); await dialog.getByRole('button', { name: '关闭', exact: true }).click(); assert.equal(await dialog.count(), 1);
    await dialog.getByRole('button', { name: '完成验证', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); const creates = (await writes('goodsListCreate')).slice(before); assert.equal(creates.length, 2); assert.deepEqual(creates[1].args, creates[0].args); assert.equal(creates[1].args.title, '验证码清单');
  });
  await record('missing list details do not substitute unrelated global list entries', async () => {
    await page.evaluate(() => { window.__goodsMock.missingItems = true; }); const before = (await writes('goodsLists')).length; await listDetail(); await page.getByText('清单项目明细暂不可用', { exact: true }).waitFor(); assert.equal((await writes('goodsLists')).length, before); assert.equal(await page.getByText('另一张清单', { exact: true }).count(), 0); await page.evaluate(() => { window.__goodsMock.missingItems = false; });
  });
  await record('account switch closes editor drafts and guest creation only opens login', async () => {
    await navigate('lists'); await page.getByRole('button', { name: '创建好物清单', exact: true }).click(); let dialog = page.getByRole('dialog', { name: '创建好物清单' }); await dialog.getByRole('textbox', { name: '清单标题' }).fill('账号甲草稿');
    await page.evaluate(() => window.__goodsAccount('654321')); await dialog.waitFor({ state: 'hidden' }); await page.getByRole('button', { name: '创建好物清单', exact: true }).click(); dialog = page.getByRole('dialog', { name: '创建好物清单' }); assert.equal(await dialog.getByRole('textbox', { name: '清单标题' }).inputValue(), '');
    await page.evaluate(() => window.__goodsAccount('')); await dialog.waitFor({ state: 'hidden' }); const before = (await writes('goodsListCreate')).length; await page.getByRole('button', { name: '创建好物清单', exact: true }).click(); assert.equal(await page.evaluate(() => window.__goodsMock.login), 1); assert.equal((await writes('goodsListCreate')).length, before);
  });
  assert.deepEqual(errors, []); await page.screenshot({ path: resolve(output, 'complete.png') });
  writeFileSync('research/goods-ui-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'synthetic isolated renderer; external network blocked; no real account writes', checks, errors }, null, 2) + '\n');
  await context.close();
} catch (error) { const page = browser?.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: resolve(output, 'failure.png') }); console.log('FAILURE_STATE', await page.locator('body').innerText()); } throw error; }
finally { await browser?.close(); await server.close(); }
