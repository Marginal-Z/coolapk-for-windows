// Actual built App and preload, with isolated test data and pre-start network
// blocking. UI dispatch checks do not claim live account writes or form access.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import electron from 'electron';
import { _electron } from 'playwright';
import { DEFAULT_ACCOUNT_SETTINGS } from '../core/account-settings-models.mjs';
import { SECONDHAND_PUBLISHING_OPERATIONS } from '../core/secondhand-publishing.mjs';

const root = process.cwd(), directory = path.join(root, '.local/parity-integration');
mkdirSync(directory, { recursive: true });
const env = { ...process.env, COOLAPK_TEST_DATA: mkdtempSync(path.join(directory, 'userdata-')) }; delete env.ELECTRON_RUN_AS_NODE;
const metadata = JSON.parse(readFileSync('package.json', 'utf8'));
writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: metadata.name, version: metadata.version, main: 'bootstrap.cjs' }));
writeFileSync(path.join(directory, 'bootstrap.cjs'), `const{app,session,ipcMain}=require('electron');
globalThis.parityMock={identity:{uid:'98765',username:'隔离集成账号',userAvatar:''},calls:[],reports:[],blocks:{rules:[],maxCount:100},posts:[],album:null,secondhandFields:null,secondhandOwner:'',secondhandClosed:false,watermarks:{enabled:true,position:'9',iconType:'0',coolPictures:false,hdr:false,present:[]},accountSettings:{values:${JSON.stringify(DEFAULT_ACCOUNT_SETTINGS)},present:[],guardExpiresAt:null,replyLocked:false},blockedNetwork:0};
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,reply)=>{globalThis.parityMock.blockedNetwork++;reply({cancel:true})}));
const register=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,handler)=>{
if(channel==='coolapk:accounts')return register(channel,()=>({ok:true,data:{accounts:[globalThis.parityMock.identity],current:globalThis.parityMock.identity}}));
if(channel==='coolapk:report')return register(channel,(_,target)=>{globalThis.parityMock.reports.push(target);return{ok:true,data:{opened:true}}});
if(channel==='coolapk:call')return register(channel,(_,operation,args={})=>{
const mock=globalThis.parityMock;mock.calls.push({operation,args});
const sample={entityType:'feed',id:'719',uid:'777',username:'隔离作者',message:'保留原来的正文',message_title:'公开样本'};
const listing=()=>({entityType:'feed',id:'823',uid:mock.secondhandOwner,username:'隔离集成账号',feedType:'ershou',message_title:mock.secondhandFields.title,message:mock.secondhandFields.message,pic:mock.secondhandFields.pic,enableModify:1,ershou_info:{feed_id:'823',ershou_status:mock.secondhandClosed?-1:0},replynum:0});
if(operation==='goodsAlbums')return{ok:true,data:{data:mock.album?[{entityType:'productAlbum',id:mock.album.id,uid:mock.album.uid,title:mock.album.title,description:mock.album.description}]:[],hasMore:false}};
if(operation==='goodsAlbum')return{ok:true,data:{data:structuredClone(mock.album)}};
if(operation==='goodsAlbumEdit'){Object.assign(mock.album,{title:args.title,description:args.description,productItems:structuredClone(args.items).map((row,index)=>({...row,id:row.id||String(9100+index)}))});return{ok:true,data:{data:{id:mock.album.id},createdId:mock.album.id}}}
if(operation==='goodsAlbumDelete'){mock.album=null;return{ok:true,data:{data:1}}}
if(operation==='secondhandPublishCategories')return{ok:true,data:{data:[{id:'100',title:'手机'},{id:'101',title:'电脑'}]}};
if(operation==='secondhandAgreementState')return{ok:true,data:{data:{accepted:true}}};
if(operation==='secondhandPublishConfig')return{ok:true,data:{data:[{key:'ram',label:'内存',single:true,required:true,options:['8GB','12GB'],allowOther:false}]}};
if(operation==='secondhandPublishPresets')return{ok:true,data:{data:[{id:'3',title:'隔离型号配置'}]}};
if(operation==='secondhandAgreementDetail')return{ok:true,data:{data:{html:'<p>隔离二手交易协议</p>',minimumReadSeconds:10.5}}};
if(operation==='secondhandAcceptAgreement')return{ok:true,data:{data:{accepted:true}}};
if(operation==='secondhandValidateLink')return{ok:true,data:{data:{link:args.link}}};
if(operation==='secondhandEditable')return{ok:true,data:{data:{id:'823',closed:mock.secondhandClosed,fields:structuredClone(mock.secondhandFields)}}};
if(operation==='secondhandCreate'){mock.secondhandFields=structuredClone(args.input);mock.secondhandOwner=mock.identity.uid;mock.secondhandClosed=false;return{ok:true,data:{data:listing()}}}
if(operation==='secondhandEdit'){Object.assign(mock.secondhandFields,structuredClone(args.patch));return{ok:true,data:{data:listing()}}}
if(operation==='secondhandClose'||operation==='secondhandStatus'){if(operation==='secondhandClose')mock.secondhandClosed=true;return{ok:true,data:{data:{id:'823',closed:mock.secondhandClosed}}}};
if(operation==='secondhandHome')return{ok:true,data:{data:mock.secondhandFields?[listing()]:[],hasMore:false}};
if(operation==='detail'&&args.id==='823'&&mock.secondhandFields)return{ok:true,data:{data:listing()}};
if(operation==='uploadImage')return{ok:true,data:{data:'https://image.coolapk.com/feed/2026/parity-local-photo.png'}};
if(operation==='imageWatermarkSettingsUpdate')Object.assign(mock.watermarks,args.patch,{enabled:args.patch.position?args.patch.position!=='0':mock.watermarks.enabled});
if(operation==='imageWatermarkSettings'||operation==='imageWatermarkSettingsUpdate')return{ok:true,data:{data:structuredClone(mock.watermarks)}};
if(operation==='accountSettingsUpdate')Object.assign(mock.accountSettings.values,args.patch);
if(operation==='accountSettings'||operation==='accountSettingsUpdate')return{ok:true,data:{data:structuredClone(mock.accountSettings)}};
if(operation==='personalDyhRecommendations'){const dyh={entityType:'dyh',id:'881',title:'隔离推荐号',userAction:{follow:0}};return{ok:true,data:{data:[dyh],sections:[{title:'小编推荐',url:'#/dyh/list?type=editor&title=%E5%B0%8F%E7%BC%96%E6%8E%A8%E8%8D%90',entities:[dyh]}],hasMore:false}}}
let data=operation==='notificationCount'?{}:operation==='accountOverview'?{...mock.identity,feed:0,follow:0,fans:0,level:0}:operation==='home'||operation==='homeHeadline'?[sample]:operation==='detail'?{...sample,id:args.id}:operation==='replies'?[{id:'720',uid:'777',username:'隔离作者',message:'隔离评论'}]:operation==='user'?{uid:args.uid,username:'隔离作者'}:operation==='catalogApp'?{id:'101',packageName:'com.example.parity',appName:'隔离应用'}:operation==='personalHomeBlocks'?structuredClone(mock.blocks):[];
if(operation==='questionCreate'||operation==='pollCreate'){data={...sample,id:operation==='questionCreate'?'721':'722',message:args.message,message_title:args.title};mock.posts.push({operation,args})}
return{ok:true,data:{data,hasMore:false}}});return register(channel,handler)};
require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`);
const desktop = await _electron.launch({ executablePath: electron, args: [directory], env, timeout: 30000 });
const checks = [], errors = [];
const record = async (name, work) => { await work(); checks.push(name); console.log('PASS', name); };
try {
  const page = await desktop.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.locator('.account-entry').getByText('隔离集成账号', { exact: true }).waitFor();
  const more = async name => {
    await page.locator('.sidebar [role="group"][aria-label="个人导航"]').getByRole('button', { name: '我的', exact: true }).click();
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('dialog', { name: '全部功能', exact: true }).getByRole('button', { name, exact: true }).click();
  };
  const lastCall = operation => desktop.evaluate((_, operation) => globalThis.parityMock.calls.filter(row => row.operation === operation).at(-1), operation);
  const callCount = operation => desktop.evaluate((_, operation) => globalThis.parityMock.calls.filter(row => row.operation === operation).length, operation);
  const waitNewCall = (operation, previous) => desktop.evaluate(async (_, { operation, previous }) => { const deadline = Date.now() + 5000; while (globalThis.parityMock.calls.filter(row => row.operation === operation).length <= previous) { if (Date.now() > deadline) throw Error('Missing refreshed IPC ' + operation); await new Promise(resolve => setTimeout(resolve, 10)); } }, { operation, previous });
  const waitCall = (operation, args = {}) => desktop.evaluate(async (_, { operation, args }) => {
    const deadline = Date.now() + 5000;
    while (!globalThis.parityMock.calls.some(row => row.operation === operation && Object.entries(args).every(([key, value]) => row.args[key] === value))) { if (Date.now() > deadline) throw Error('Missing IPC ' + operation); await new Promise(resolve => setTimeout(resolve, 10)); }
  }, { operation, args });
  await record('My digital, own lists and cloud backup links dispatch native screens without phone handoff', async () => {
    await more('我的数码'); await page.getByRole('tab', { name: '关注', exact: true }).waitFor();
    await waitCall('personalProductFollowing');
    for (const [title, type] of [['机主', 'owner'], ['想买', 'wish'], ['买过', 'buy']]) { await page.getByRole('tab', { name: title, exact: true }).click(); await page.waitForFunction(title => [...document.querySelectorAll('.personal-tabs [role="tab"]')].some(node => node.textContent === title && node.getAttribute('aria-selected') === 'true'), title); await waitCall('catalogMyProducts', { type }); assert.equal((await lastCall('catalogMyProducts')).args.type, type); }
    await more('我的清单'); await page.getByText('还没有创建清单', { exact: true }).waitFor(); assert.equal((await lastCall('goodsAlbums')).args.uid, '98765');
    await more('备份单'); await page.getByText('你还没有创建过备份单', { exact: true }).waitFor(); await waitCall('personalBackups');
    assert.equal(await page.getByRole('button', { name: '创建手机应用备份', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '在手机上恢复应用', exact: true }).count(), 0);
  });
  await record('My homepage block management is connected and only headline reads apply its rules', async () => {
    await more('首页屏蔽管理'); await page.getByRole('tab', { name: /^节点/ }).waitFor(); await waitCall('personalHomeBlocks');
    await desktop.evaluate(() => { globalThis.parityMock.blocks = { rules: [{ scope: 'word', value: '原来的', title: '原来的' }], maxCount: 100 }; });
    await page.locator('.sidebar [role="group"][aria-label="社区导航"]').getByRole('button', { name: '首页', exact: true }).click(); await page.locator('[data-feed-id="719"]').waitFor();
    await page.getByRole('tab', { name: '头条', exact: true }).click(); await page.getByText('本页动态已按屏蔽设置过滤', { exact: true }).waitFor(); assert.equal(await page.locator('[data-feed-id="719"]').count(), 0);
    await page.getByRole('tab', { name: '推荐', exact: true }).click(); await page.locator('[data-feed-id="719"]').waitFor();
  });
  await record('Kankan uses the two phone categories and its more link preserves the native list filters', async () => {
    await more('看看号'); await page.getByRole('tab', { name: '我关注的', exact: true }).waitFor(); await page.getByRole('tab', { name: '我管理的', exact: true }).click(); await waitCall('catalogDyhEditing');
    await page.getByRole('button', { name: '添加更多看看号', exact: true }).click(); await page.getByText('隔离推荐号', { exact: true }).waitFor(); await waitCall('personalDyhRecommendations');
    await page.getByRole('button', { name: '查看更多', exact: true }).click(); await waitCall('page', { url: '/dyh/list?type=editor&title=%E5%B0%8F%E7%BC%96%E6%8E%A8%E8%8D%90' });
    await page.locator('.sidebar [role="group"][aria-label="社区导航"]').getByRole('button', { name: '首页', exact: true }).click(); await page.locator('[data-feed-id="719"]').waitFor();
  });
  await record('switching the ordinary composer to a question preserves its text draft and opens the actual question editor', async () => {
    await page.getByRole('button', { name: '发布动态', exact: true }).click(); let dialog = page.getByRole('dialog', { name: '发布动态', exact: true });
    await dialog.locator('#publish-message').fill('原生编辑器切换前的草稿'); await dialog.getByRole('button', { name: '提问', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '提问', exact: true }); await dialog.getByLabel('问题标题', { exact: true }).fill('集成测试的问题'); await dialog.getByLabel('问题补充', { exact: true }).fill('合成测试正文');
    const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('coolapk-drafts:98765'))); assert.equal(draft[0].message, '原生编辑器切换前的草稿');
    await dialog.getByRole('button', { name: '发布问题', exact: true }).click(); await page.getByRole('dialog', { name: '动态详情', exact: true }).waitFor(); assert.equal((await lastCall('questionCreate')).args.title, '集成测试的问题？');
    await page.getByRole('button', { name: '关闭动态详情', exact: true }).click();
  });
  await record('the actual main app opens PK polling and passes the two allowed options to native dispatch', async () => {
    await page.getByRole('button', { name: '发布动态', exact: true }).click(); await page.getByRole('dialog', { name: '发布动态', exact: true }).getByRole('button', { name: '发起投票', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '发起投票', exact: true }); await dialog.getByLabel('投票标题', { exact: true }).fill('合成PK'); await dialog.getByLabel('投票类型', { exact: true }).selectOption('0');
    await dialog.getByLabel('正方观点', { exact: true }).fill('正方'); await dialog.getByLabel('反方观点', { exact: true }).fill('反方'); await dialog.getByRole('button', { name: '发布投票', exact: true }).click();
    await page.getByRole('dialog', { name: '动态详情', exact: true }).waitFor(); const request = await lastCall('pollCreate'); assert.equal(request.args.pollType, 0); assert.deepEqual(request.args.options, ['正方', '反方']); await page.getByRole('button', { name: '关闭动态详情', exact: true }).click();
  });
  await record('feed, comment, user and application report buttons preserve their distinct fixed targets', async () => {
    await page.locator('[data-feed-id="719"]').getByRole('button', { name: '举报动态', exact: true }).click();
    await page.locator('[data-feed-id="719"]').getByRole('button', { name: '查看评论', exact: true }).click(); const detail = page.getByRole('dialog', { name: '动态详情', exact: true }); await detail.getByRole('button', { name: '举报评论', exact: true }).click(); await detail.getByRole('button', { name: '关闭动态详情', exact: true }).click();
    await page.locator('[data-feed-id="719"] .author-button').click(); await page.getByRole('button', { name: '举报用户', exact: true }).click();
    await page.getByLabel('搜索酷安', { exact: true }).fill('https://www.coolapk.com/apk/com.example.parity'); await page.getByLabel('搜索酷安', { exact: true }).press('Enter'); await page.getByRole('button', { name: '举报应用', exact: true }).click();
    assert.deepEqual(await desktop.evaluate(() => globalThis.parityMock.reports), [{ type: 'feed', id: '719' }, { type: 'feed_reply', id: '720' }, { type: 'user', id: '777' }, { type: 'apk', packageName: 'com.example.parity' }]);
  });
  await record('manual palette changes reach the actual app chrome and survive closing settings', async () => {
    await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '设置', exact: true }); await dialog.getByRole('button', { name: /^界面显示/ }).click(); await dialog.getByLabel('主题风格', { exact: true }).selectOption('blue');
    await page.waitForFunction(() => document.documentElement.dataset.palette === 'blue' && document.documentElement.style.getPropertyValue('--theme-header') === '#2196f3'); await dialog.getByRole('button', { name: '关闭', exact: true }).click(); assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'blue');
  });
  await record('actual Settings opens the cloud watermarks for the active account and sends only the changed field', async () => {
    await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '设置', exact: true }); await dialog.getByRole('button', { name: /^图片设置/ }).click();
    await dialog.getByLabel('水印位置', { exact: true }).selectOption('7'); await dialog.getByText('已保存并核对云端水印设置', { exact: true }).waitFor(); assert.deepEqual((await lastCall('imageWatermarkSettingsUpdate')).args.patch, { position: '7' });
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('actual privacy and subscription menu entries reach account-scoped native settings', async () => {
    await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: /^隐私设置/ }).click();
    let dialog = page.getByRole('dialog', { name: '隐私设置', exact: true }); await dialog.getByLabel('接受私信的范围', { exact: true }).selectOption('1'); await waitCall('accountSettingsUpdate', {}); assert.deepEqual((await lastCall('accountSettingsUpdate')).args.patch, { receive_message: '1' });
    await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: /^订阅消息提醒/ }).click(); dialog = page.getByRole('dialog', { name: '订阅消息提醒', exact: true });
    await dialog.getByRole('switch', { name: '订阅特别关注通知', exact: true }).click(); await page.waitForFunction(() => [...document.querySelectorAll('[role="switch"]')].some(node => node.getAttribute('aria-label') === '订阅特别关注通知' && node.checked && !node.disabled)); assert.deepEqual((await lastCall('accountSettingsUpdate')).args.patch, { subscribe_special_follow_feed_notify: true });
    await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('My lists opens the actual published product album, saves full project edits and confirms deletion', async () => {
    await desktop.evaluate(() => { globalThis.parityMock.album = { id: '901', uid: '98765', title: '隔离产品清单', description: '原产品说明', album_type: 1, canEdit: true, canDelete: true, enableModify: 1, productItems: [{ id: '9011', level: '1', item_id: '', item_name: '隔离自定义产品', item_description: '原推荐理由', item_logo: '', item_images: '' }, { id: '9012', level: '1', item_id: '77', item_name: '隔离关联型号', item_description: '关联理由', item_logo: '', item_images: '' }] }; });
    await more('我的清单'); await page.getByRole('button', { name: /隔离产品清单/ }).click(); await page.getByRole('heading', { name: '隔离产品清单', exact: true, level: 2 }).waitFor(); await waitCall('goodsAlbum', { id: '901', uid: '98765' });
    await page.getByRole('button', { name: '编辑产品专辑', exact: true }).click(); const editor = page.getByRole('dialog', { name: '编辑产品专辑', exact: true });
    assert.equal(await editor.getByLabel('项目 2 名称', { exact: true }).isDisabled(), true); await editor.getByLabel('产品专辑标题', { exact: true }).fill('隔离清单已编辑'); await editor.getByLabel('产品专辑说明', { exact: true }).fill('保存后的产品说明'); await editor.getByLabel('项目 1 推荐理由', { exact: true }).fill('保存后的推荐理由'); await editor.getByRole('button', { name: '上移项目 2', exact: true }).click(); await editor.getByRole('button', { name: '保存专辑修改', exact: true }).click(); await editor.waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: '隔离清单已编辑', exact: true }).waitFor(); await page.locator('.goods-item > p').filter({ hasText: '保存后的推荐理由' }).waitFor(); const request = (await lastCall('goodsAlbumEdit')).args; assert.equal(request.id, '901'); assert.deepEqual(request.expectedItemIds, ['9011', '9012']); assert.deepEqual(request.items.map(row => row.id), ['9012', '9011']); assert.equal(request.items[0].item_id, '77');
    await page.getByRole('button', { name: '删除产品专辑', exact: true }).click(); let dialog = page.getByRole('dialog', { name: '删除产品专辑', exact: true }); const before = await desktop.evaluate(() => globalThis.parityMock.calls.filter(row => row.operation === 'goodsAlbumDelete').length); await dialog.getByRole('button', { name: '关闭', exact: true }).click(); assert.equal(await desktop.evaluate(() => globalThis.parityMock.calls.filter(row => row.operation === 'goodsAlbumDelete').length), before);
    await page.getByRole('button', { name: '删除产品专辑', exact: true }).click(); dialog = page.getByRole('dialog', { name: '删除产品专辑', exact: true }); await dialog.getByRole('button', { name: '确认删除产品专辑', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); await page.getByRole('button', { name: '创建产品专辑', exact: true }).waitFor(); assert.deepEqual((await lastCall('goodsAlbumDelete')).args, { id: '901' });
    await more('我的清单'); await page.getByText('还没有创建清单', { exact: true }).waitFor(); assert.equal(await desktop.evaluate(() => globalThis.parityMock.album), null);
  });
  await record('the actual Secondhand sidebar publishes through its dialog and refreshes the still-mounted market list', async () => {
    assert.equal(SECONDHAND_PUBLISHING_OPERATIONS.length, 12); await page.locator('.sidebar [role="group"][aria-label="社区导航"]').getByRole('button', { name: '二手', exact: true }).click(); await page.getByRole('heading', { name: '二手市场', exact: true }).waitFor(); await waitCall('secondhandHome'); await page.getByRole('button', { name: '发布闲置', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '发布二手信息', exact: true });
    await dialog.getByText('已同意酷安二手交易协议', { exact: true }).waitFor(); assert.equal(await page.locator('.workspace').evaluate(node => node.inert), true); assert.equal(await page.locator('.sidebar').evaluate(node => node.inert), true);
    await dialog.getByLabel('二手信息标题', { exact: true }).fill('隔离闲置已发布'); await dialog.getByLabel('二手信息描述', { exact: true }).fill('隔离闲置发布描述'); await dialog.getByLabel('闲置价格', { exact: true }).fill('199'); await dialog.getByLabel('闲置商品链接', { exact: true }).fill('https://2.taobao.com/item?id=823');
    const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4; canvas.getContext('2d').fillRect(0, 0, 4, 4); return canvas.toDataURL().split(',')[1]; }); await dialog.getByLabel('添加图片附件', { exact: true }).setInputFiles({ name: 'isolated-parity.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }); await dialog.getByRole('button', { name: '发布二手信息', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    let detail = page.getByRole('dialog', { name: '动态详情', exact: true }); await detail.getByRole('heading', { name: '隔离闲置已发布', exact: true }).waitFor(); const created = (await lastCall('secondhandCreate')).args.input; assert.equal(created.title, '隔离闲置已发布'); assert.equal(created.price, '199'); assert.equal(created.pic, 'https://image.coolapk.com/feed/2026/parity-local-photo.png'); assert.equal(created.categoryId, '100'); await waitCall('detail', { id: '823' }); await detail.getByRole('button', { name: '关闭动态详情', exact: true }).click();
    await page.locator('.secondhand-results [data-entity-id="823"] .entity-poster-title').getByText('隔离闲置已发布', { exact: true }).waitFor(); assert.equal(await page.locator('.workspace').evaluate(node => node.inert), false); assert.equal(await page.locator('.sidebar').evaluate(node => node.inert), false);
  });
  await record('owned Secondhand Detail edits, reads back and closes the original listing while preserving its identity', async () => {
    await page.locator('.secondhand-results [data-entity-id="823"] .entity-poster-open').click(); let detail = page.getByRole('dialog', { name: '动态详情', exact: true }); await detail.getByRole('button', { name: '编辑闲置', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '编辑二手信息', exact: true });
    await dialog.getByLabel('二手信息标题', { exact: true }).waitFor(); await page.waitForFunction(() => document.querySelector('[aria-label="二手信息标题"]')?.value === '隔离闲置已发布'); await dialog.getByLabel('二手信息标题', { exact: true }).fill('隔离闲置已编辑'); await dialog.getByLabel('二手信息描述', { exact: true }).fill('保存后的闲置描述'); await dialog.getByRole('button', { name: '保存二手信息', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    detail = page.getByRole('dialog', { name: '动态详情', exact: true }); await detail.getByRole('heading', { name: '隔离闲置已编辑', exact: true }).waitFor(); await detail.getByText('保存后的闲置描述', { exact: true }).waitFor(); assert.deepEqual((await lastCall('secondhandEdit')).args, { id: '823', patch: { title: '隔离闲置已编辑', message: '保存后的闲置描述' } });
    await detail.getByRole('button', { name: '关闭动态详情', exact: true }).click(); await page.locator('.secondhand-results [data-entity-id="823"] .entity-poster-title').getByText('隔离闲置已编辑', { exact: true }).waitFor(); await page.locator('.secondhand-results [data-entity-id="823"] .entity-poster-open').click(); detail = page.getByRole('dialog', { name: '动态详情', exact: true });
    const marketReads = await callCount('secondhandHome'), detailReads = await callCount('detail'); await detail.getByRole('button', { name: '关闭交易', exact: true }).click(); const confirm = page.getByRole('dialog', { name: '关闭交易', exact: true }); await confirm.getByRole('button', { name: '确定关闭交易', exact: true }).click(); await confirm.waitFor({ state: 'hidden' }); assert.deepEqual((await lastCall('secondhandClose')).args, { id: '823', confirmed: true }); assert.equal(await desktop.evaluate(() => globalThis.parityMock.secondhandClosed), true); await waitNewCall('secondhandHome', marketReads); await waitNewCall('detail', detailReads);
    await detail.getByRole('button', { name: '编辑闲置', exact: true }).click(); const closedEditor = page.getByRole('dialog', { name: '编辑二手信息', exact: true }); await closedEditor.getByText('此交易已关闭，编辑信息后仍不能重新开启。', { exact: true }).waitFor(); assert.equal((await lastCall('secondhandEditable')).args.id, '823'); await closedEditor.getByRole('button', { name: '关闭', exact: true }).last().click();
  });
  await record('switching from the composer to Secondhand uses the real dialog and account changes discard its draft', async () => {
    await page.getByRole('button', { name: '发布动态', exact: true }).click(); const composer = page.getByRole('dialog', { name: '发布动态', exact: true }); await composer.getByRole('button', { name: '闲置交易', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '发布二手信息', exact: true }); await dialog.getByText('已同意酷安二手交易协议', { exact: true }).waitFor(); await dialog.getByLabel('二手信息标题', { exact: true }).fill('旧账号的闲置草稿');
    const before = await desktop.evaluate(() => globalThis.parityMock.calls.filter(row => ['secondhandCreate', 'secondhandEdit', 'secondhandClose'].includes(row.operation)).length);
    await desktop.evaluate(({ BrowserWindow }) => { globalThis.parityMock.identity = { uid: '98766', username: '隔离第二账号', userAvatar: '' }; BrowserWindow.getAllWindows()[0].webContents.send('coolapk:account', { ok: true, data: { accounts: [globalThis.parityMock.identity], current: globalThis.parityMock.identity } }); }); await dialog.waitFor({ state: 'hidden' }); await page.locator('.account-entry').getByText('隔离第二账号', { exact: true }).waitFor();
    assert.equal(await desktop.evaluate(() => globalThis.parityMock.calls.filter(row => ['secondhandCreate', 'secondhandEdit', 'secondhandClose'].includes(row.operation)).length), before); assert.equal(await page.locator('.workspace').evaluate(node => node.inert), false); await page.getByRole('button', { name: '发布动态', exact: true }).click(); await page.getByRole('dialog', { name: '发布动态', exact: true }).getByRole('button', { name: '闲置交易', exact: true }).click(); const clean = page.getByRole('dialog', { name: '发布二手信息', exact: true }); assert.equal(await clean.getByLabel('二手信息标题', { exact: true }).inputValue(), ''); await clean.getByRole('button', { name: '关闭', exact: true }).last().click();
    await desktop.evaluate(({ BrowserWindow }) => { globalThis.parityMock.identity = { uid: '98765', username: '隔离集成账号', userAvatar: '' }; BrowserWindow.getAllWindows()[0].webContents.send('coolapk:account', { ok: true, data: { accounts: [globalThis.parityMock.identity], current: globalThis.parityMock.identity } }); }); await page.locator('.account-entry').getByText('隔离集成账号', { exact: true }).waitFor();
  });
  await record('disabling account history clears local records and stops new recording; protection restricts publishing and private messages', async () => {
    await page.locator('.sidebar [role="group"][aria-label="社区导航"]').getByRole('button', { name: '首页', exact: true }).click(); await page.locator('[data-feed-id="719"]').getByRole('button', { name: '查看评论', exact: true }).click(); await page.getByRole('button', { name: '关闭动态详情', exact: true }).click();
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('coolapk-history:98765') || '[]').length) > 0);
    await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: /^隐私设置/ }).click(); let dialog = page.getByRole('dialog', { name: '隐私设置', exact: true });
    await dialog.getByRole('switch', { name: '开启浏览历史记录', exact: true }).click(); await page.getByRole('dialog', { name: '关闭浏览历史记录', exact: true }).getByRole('button', { name: '确定关闭', exact: true }).click(); await page.waitForFunction(() => localStorage.getItem('coolapk-history:98765') === null);
    await dialog.getByRole('switch', { name: '一键防护', exact: true }).click(); await page.getByRole('dialog', { name: '开启一键防护', exact: true }).getByRole('button', { name: '确定开启', exact: true }).click(); await dialog.getByLabel('接受私信的范围', { exact: true }).waitFor(); await page.waitForFunction(() => document.querySelector('[aria-label="接受私信的范围"]')?.disabled);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '发布动态', exact: true }).click(); await page.getByText('一键防护开启期间暂停发布动态', { exact: true }).waitFor(); assert.equal(await page.getByRole('dialog', { name: '发布动态', exact: true }).count(), 0);
    await page.locator('[data-feed-id="719"]').getByRole('button', { name: '查看评论', exact: true }).click(); await page.getByRole('button', { name: '关闭动态详情', exact: true }).click(); assert.equal(await page.evaluate(() => localStorage.getItem('coolapk-history:98765')), null);
    await page.locator('[data-feed-id="719"] .author-button').click(); await page.getByRole('button', { name: '发私信', exact: true }).click(); await page.getByText('一键防护开启期间暂停发送私信', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);
  });
  await record('a blocked official login stays visibly failed without discarding the current account or marking it logged in', async () => {
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('coolapk:account', { ok: false, error: { code: 'LOGIN_BLOCKED', message: '隔离官方登录安全策略拦截（EdgeOne 567）' } }));
    const dialog = page.getByRole('dialog', { name: '登录酷安', exact: true }); await dialog.getByText('隔离官方登录安全策略拦截（EdgeOne 567）', { exact: true }).waitFor(); assert.equal(await page.locator('.account-entry strong').textContent(), '隔离集成账号'); await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  });
  assert.deepEqual(errors, []);
  const counters = await desktop.evaluate(() => { const count = operation => globalThis.parityMock.calls.filter(row => row.operation === operation).length; return { calls: globalThis.parityMock.calls.length, syntheticCreates: globalThis.parityMock.posts.length, goodsEdits: count('goodsAlbumEdit'), goodsDeletes: count('goodsAlbumDelete'), secondhandCreates: count('secondhandCreate'), secondhandEdits: count('secondhandEdit'), secondhandCloses: count('secondhandClose'), formOpens: globalThis.parityMock.reports.length, blockedNetwork: globalThis.parityMock.blockedNetwork }; });
  writeFileSync('research/parity-integration-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'Actual built Electron App and preload; isolated synthetic API/identity/report IPC; outside requests blocked before main startup; no actual accounts or social writes', checks, errors, counters }, null, 2) + '\n');
} catch (error) {
  const page = desktop.windows()[0]; if (page) { await page.screenshot({ path: path.join(directory, 'failure.png') }); console.log('FAILURE_STATE', await page.locator('body').innerText()); } throw error;
} finally { await desktop.close(); }
