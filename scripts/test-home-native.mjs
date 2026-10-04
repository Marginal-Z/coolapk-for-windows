// Real built App, Electron main, sandboxed preload and native settings metadata.
// Only business reads are fixtures; all external traffic and write calls stop here.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import playwright from 'playwright';
import { flattenEntities } from '../core/client.mjs';
import { DEFAULT_ACCOUNT_SETTINGS } from '../core/account-settings-models.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, '.local/home-native-check'); mkdirSync(directory, { recursive: true });
const packageMetadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const env = { ...process.env, COOLAPK_TEST_DATA: mkdtempSync(path.join(directory, 'userdata-')) }; delete env.ELECTRON_RUN_AS_NODE;
const image = 'https://127.0.0.1/coolapk-home-native-image.png';
const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="#14874e"/><circle cx="80" cy="40" r="24" fill="white"/></svg>';
const topicNames = ['推荐','热门','我的关注','值得买','摄影','系统','玩机','苹果','电脑','配件','车','AI','美化','游戏','情感','生活','交易','运动','学习','动漫','户外','酷安人均','手机SoC','处理器'];
const topicCategories = topicNames.map(title => ({ entityType: 'verticalColumnsFullPage', title, url: title === '热门' ? '/page?url=V11_VERTICL_TOPIIC_HOT_TAB' : title === '我的关注' ? '#/topic/userFollowTagList?cacheExpires=60' : '#/topic/tagList?keywords=' + encodeURIComponent(title) + '&sort=hot_num' }));
const channels = [['1635','话题','/page?url=V11_VERTICAL_TOPIC'],['2759','关注','/page?url=V15_HOME_TAB_FOLLOW'],['420','头条','/main/headline'],['415','热榜','/page?url=V9_HOME_TAB_RANKING'],['1229','快讯','/page?url=V11_HOME_TAB_NEWS'],['1742','新机','/page?url=V11_HOME_NEW'],['1710','汽车','/page?url=V11_HOME_CAR'],['2261','开箱','/page?url=V13_IOSHOME_OPENSHOW'],['2274','摄影','/page?url=V13_HOME_SHEYING'],['2954','游戏','/page?url=V15_YOUXI'],['1681','教程','/page?url=V11_HOME_TAB_JC'],['2500','外设','/page?url=V14_WAISHE'],['413','视频','/page?url=V9_HOME_TAB_SHIPIN'],['1754','美化','/page?url=V11_HOME_MEIHUA'],['421','直播','/page?url=V9_HOME_TAB_LIVE'],['417','问答','/page?url=V9_HOME_TAB_WENDA'],['3337','神券','/clickUrl/csjMallFeedList?posId=103115081']].map(([id,title,url]) => ({ id, entityType: 'page', title, url, page_visibility: 1 }));
const feed = (id, message) => ({ entityType: 'feed', id: String(id), uid: '77001', username: '原生首页测试作者', message, dateline: 1700000000, likenum: 1, replynum: 2 });
const topic = (title, id) => ({ entityType: 'topic', id, title, logo: image, hot_num: 125000, url: '/t/' + encodeURIComponent(title) });
const homeSurface = [
  { entityType: 'card', entityTemplate: 'imageCarouselCard_1', entityId: '101', title: '官方活动轮播', entities: [{ entityType: 'event', id: '9001', title: '原生活动横幅', pic: image, url: '/event/9001' }, { entityType: 'page', id: '9002', title: '话题横幅', pic: image, url: '/page?url=V11_VERTICAL_TOPIC' }] },
  { entityType: 'card', entityTemplate: 'iconLinkGridCard', entityId: '102', title: '十项快捷入口', entities: Array.from({ length: 10 }, (_, index) => ({ entityType: index === 1 ? 'live' : 'page', id: String(9100 + index), title: index === 0 ? '应用搜索入口' : index === 1 ? '原生直播入口' : index === 2 ? '游戏搜索入口' : '快捷入口 ' + index, pic: image, url: index === 0 ? '/apk/search' : index === 1 ? '/live/9101' : index === 2 ? '/game/search' : '/page?url=V11_NATIVE_SHORTCUT_' + index })) },
  { entityType: 'card', entityTemplate: 'iconMiniScrollCard', entityId: '103', title: '二十项兴趣话题', entities: Array.from({ length: 20 }, (_, index) => topic('原生兴趣话题 ' + index, 9200 + index)) },
  { entityType: 'card', entityTemplate: 'productTimelineListCard', entityId: '104', title: '产品发布日历', entities: [{ entityType: 'product', id: '9301', title: '原生测试手机', logo: image, release_time: '2026-10-05', hot_num: 125000, url: '/product/9301' }, { entityType: 'product', id: '9302', title: '原生测试平板', logo: image, release_time: '2026-10-07', hot_num: 240000, url: '/product/9302' }] },
  { entityType: 'card', entityTemplate: 'titleCard', entityId: '105', title: '公告文字标题', description: '说明文字应当作为文本显示，不创建虚假的按钮。' },
  { entityType: 'card', entityTemplate: 'textCard', entityId: '106', title: '只读提示', description: '没有链接的提示卡片不可点击。' },
  { entityType: 'card', entityTemplate: 'futurePhoneTemplate', entityId: '107', title: '未知分组仍显示内容', entities: [{ entityType: 'topic', id: '9401', title: '未来分组话题', logo: image, hot_num: 123, url: '/t/未来分组话题' }] },
  { entityType: 'fab', id: '9501', title: '带汽车话题的文章入口', url: '/feed/writer?type=article&tag=' + encodeURIComponent('汽车') },
  feed('9601', '推荐专属动态；切换头条后不应与头条列表混合。'),
];
const listResult = rows => ({ data: flattenEntities(rows), surfaceItems: rows, hasMore: false });
const fixtures = { channels, topicCategories, home: listResult(homeSurface), headline: listResult([feed('9602','仅头条动态')]), accountSettings: { values: DEFAULT_ACCOUNT_SETTINGS, present: Object.keys(DEFAULT_ACCOUNT_SETTINGS), guardExpiresAt: null, replyLocked: false }, image };
writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: packageMetadata.name, version: packageMetadata.version, main: 'bootstrap.cjs' }));
writeFileSync(path.join(directory, 'bootstrap.cjs'), `const {app,session,ipcMain}=require('electron');
const fixtures=${JSON.stringify(fixtures)};globalThis.homeNative={calls:[],blockedNetwork:0,imageLoads:0,allowImages:false,blockedWrites:[],unexpectedReads:[]};
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(request,reply)=>{if(request.url===fixtures.image&&globalThis.homeNative.allowImages){globalThis.homeNative.imageLoads++;return reply({cancel:false})}globalThis.homeNative.blockedNetwork++;reply({cancel:true})}));
const register=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,handler)=>{
if(channel!=='coolapk:call')return register(channel,handler);
return register(channel,async(event,operation,args={})=>{
 const mock=globalThis.homeNative;mock.calls.push({operation,args:structuredClone(args)});
 if(!event.sender.getURL().startsWith('file:')||!args||typeof args!=='object'||Array.isArray(args))return{ok:false,error:{code:'INPUT',message:'隔离原生测试拒绝无效来源'}};
 const result=data=>({ok:true,data}),rows=data=>result({data,hasMore:false});
 switch(operation){
 case'init':return rows([{title:'首页',entityType:'card',entities:fixtures.channels}]);
 case'hotSearch':return rows([{entityType:'hotSearch',title:'原生热搜词',url:'searchTab://topic?keyword=原生热搜词'}]);
 case'homeHotTopics':return rows([{tag:'原生侧栏热点',count:125000}]);
 case'home':return result(fixtures.home);
 case'homeHeadline':return result(fixtures.headline);
 case'homeUpdates':case'homeEditorChoice':case'homeNews':case'homeDigest':return result({data:[{entityType:'topic',id:9900,title:'栏目非动态 '+operation,logo:fixtures.image,hot_num:123}],surfaceItems:[{entityType:'topic',id:9900,title:'栏目非动态 '+operation,logo:fixtures.image,hot_num:123}],hasMore:false});
 case'page':{
  if(args.url==='V11_VERTICAL_TOPIC')return result({data:[],surfaceItems:[{entityType:'card',entityTemplate:'verticalColumnsFullPageCard',entities:fixtures.topicCategories,extraDataArr:{selectedTab:'热门'}}],hasMore:false});
  if(String(args.url).includes('V11_VERTICL_TOPIIC_HOT_TAB')||String(args.url).startsWith('#/topic/tagList'))return rows(Array.from({length:20},(_,index)=>({entityType:'topic',id:9800+index,title:'分类热门话题 '+index,logo:fixtures.image,hot_num:125000,url:'/t/'+encodeURIComponent('分类热门话题 '+index)})));
  if(args.url==='/main/headline')return result(fixtures.headline);
  const channel=fixtures.channels.find(item=>item.url===args.url),title='栏目非动态 '+(channel?.title||'快捷入口');const item={entityType:'topic',id:9901,title,logo:fixtures.image,hot_num:123};return result({data:[item],surfaceItems:[{entityType:'card',entityTemplate:'futurePhoneTemplate',title:'分组 '+(channel?.title||'快捷入口'),entities:[item]}],hasMore:false});
 }
 case'search':return rows([{entityType:'topic',id:9801,title:'搜索结果 '+args.query+' '+args.type,logo:fixtures.image,hot_num:125000}]);
 case'searchSuggestions':return rows([{entityType:'hotSearch',title:'跳转话题热搜',url:'searchTab://topic?keyword=原生搜索跳转'}]);
 case'searchSuggestionsApp':return rows([]);
 case'topicDetail':return result({data:{title:args.tag,description:'原生话题详情',logo:fixtures.image,follownum:123}});
 case'topicEntries':case'topicServerTab':return rows([]);
 case'catalogEvent':return result({data:{id:args.id,title:'原生活动详情',description:'来自轮播导航的活动详情。',pic:fixtures.image}});
 case'catalogProduct':return result({data:{id:args.id,title:'原生测试手机详情',description:'来自发布日历的产品详情。',logo:fixtures.image,tabList:[{title:'讨论',url:'/product/feedList?id='+args.id}]}});
 case'catalogProductFeeds':case'catalogProductSubtab':case'catalogProductRatings':case'catalogProductRatingPage':return rows([]);
 case'liveDetail':return result({data:{id:args.id,title:'原生直播详情',description:'来自快捷入口的直播详情。',liveStatus:0,pic:fixtures.image}});
 case'accountSettings':return result({data:fixtures.accountSettings});
 case'notificationCount':return result({data:{}});
 case'personalHomeBlocks':return result({data:{users:[],topics:[],products:[],keywords:[]}});
 default:if(/^(?:action|publish|upload|edit|create|delete|report|send|.*(?:Follow|Wish|Buy))/.test(operation))mock.blockedWrites.push(operation);else mock.unexpectedReads.push(operation);return{ok:false,error:{code:'TEST_UNSUPPORTED',message:'隔离测试未授权此操作'}};
 }
});};require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`);

const desktop = await playwright._electron.launch({ executablePath: electron, args: [directory], env, timeout: 30000 });
const checks = [], errors = [], measurements = {};
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
let page, fixtureImageLoads = 0;
try {
  page = await desktop.firstWindow(); page.on('pageerror', failure => errors.push(failure.message));
  await page.context().route(image, route => { fixtureImageLoads++; return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: imageSvg }); });
  await desktop.evaluate(() => { globalThis.homeNative.allowImages = true; }); await page.reload();
  const main = page.locator('main.main-scroll'), homeTabs = page.getByRole('tablist', { name: '首页栏目', exact: true });
  const home = async () => { await page.locator('.sidebar').getByRole('button', { name: '首页', exact: true }).click(); await homeTabs.getByRole('tab', { name: '推荐', exact: true }).click(); await main.locator('[data-feed-id="9601"]').waitFor(); };
  const callRows = () => desktop.evaluate(() => structuredClone(globalThis.homeNative.calls));
  await record('real Electron main and strict sandboxed preload load the built App in fresh D data', async () => {
    await main.locator('[data-feed-id="9601"]').waitFor();
    const native = await desktop.evaluate(({ app, BrowserWindow }) => ({ userData: app.getPath('userData'), version: app.getVersion(), preferences: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences() }));
    assert.equal(path.resolve(native.userData).toLowerCase(), path.resolve(env.COOLAPK_TEST_DATA).toLowerCase()); assert.ok(/^D:\\/i.test(native.userData)); assert.equal(native.version, packageMetadata.version);
    assert.equal(native.preferences.contextIsolation, true); assert.equal(native.preferences.sandbox, true); assert.equal(native.preferences.nodeIntegration, false);
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined'); assert.equal(await page.evaluate(() => typeof window.coolapk.call), 'function');
    assert.match(page.url(), /\/dist\/index\.html$/); measurements.runtime = { version: native.version, isolatedD: true, actualMainAndPreload: true };
  });
  await record('homepage preserves carousel, all 10 shortcuts, all 20 interests, timeline date and heat, text and unknown groups', async () => {
    assert.equal(await main.locator('.home-banner').count(), 2); assert.equal(await main.locator('.home-shortcut').count(), 10); assert.equal(await main.locator('.home-interest').count(), 20);
    const timeline = main.locator('.home-timeline'); assert.equal(await timeline.locator('.home-timeline-row').count(), 2);
    assert.ok(await timeline.getByText('2026-10-05', { exact: true }).count()); assert.ok(await timeline.getByText('12.5万 热度', { exact: true }).count());
    for (const title of ['公告文字标题','只读提示','未知分组仍显示内容','未来分组话题']) assert.ok(await main.getByText(title, { exact: true }).count());
    for (const text of ['公告文字标题','只读提示']) {
      const section = main.locator('.home-text-section').filter({ has: page.getByRole('heading', { name: text, exact: true }) });
      assert.equal(await section.count(), 1); assert.equal(await section.getByRole('button').count(), 0);
    }
    await main.locator('.home-timeline').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => { const images = Array.from(document.querySelectorAll('.home-banner img,.home-shortcut img,.home-timeline img')); return images.length === 14 && images.every(image => image.complete && image.naturalWidth > 0); });
    await main.locator('.home-banner').first().focus(); assert.equal(await main.locator('.home-banner').first().evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
    await page.screenshot({ path: path.join(directory, 'home.png') });
  });
  await record('headline shares common homepage cards and renders only its own feed', async () => {
    await homeTabs.getByRole('tab', { name: '头条', exact: true }).click(); await main.locator('[data-feed-id="9602"]').waitFor();
    assert.equal(await main.locator('[data-feed-id="9601"]').count(), 0); assert.equal(await main.locator('.home-banner').count(), 2); assert.equal(await main.locator('.home-shortcut').count(), 10); assert.equal(await main.locator('.home-interest').count(), 20);
  });
  await record('topic homepage and topic plaza render all 24 official categories with configured popular selection', async () => {
    await homeTabs.getByRole('tab', { name: '话题', exact: true }).click(); const discovery = main.getByRole('region', { name: '发现话题', exact: true });
    await discovery.getByRole('button', { name: '分类热门话题 0 热度 12.5万', exact: true }).waitFor(); assert.deepEqual(await discovery.getByRole('tab').allTextContents(), topicNames); assert.equal(await discovery.getByRole('tab', { name: '热门', exact: true }).getAttribute('aria-selected'), 'true');
    await discovery.getByRole('tab', { name: '我的关注', exact: true }).click(); await discovery.getByText('登录后查看你关注的话题。', { exact: true }).waitFor();
    assert.equal((await callRows()).filter(call => String(call.args.url).includes('userFollowTagList')).length, 0);
    await page.locator('.sidebar').getByRole('button', { name: '话题广场', exact: true }).click(); await discovery.getByRole('tab', { name: '热门', exact: true }).waitFor();
    assert.deepEqual(await discovery.getByRole('tab').allTextContents(), topicNames);
  });
  await record('every visible home channel keeps its non-feed server content', async () => {
    await home(); const labels = await homeTabs.getByRole('tab').allTextContents(); measurements.homeChannels = labels;
    for (const title of labels.filter(title => !['推荐','话题','头条'].includes(title))) {
      await homeTabs.getByRole('tab', { name: title, exact: true }).click();
      const source = channels.find(channel => channel.title === title), operation = { '编辑精选': 'homeEditorChoice', '更新': 'homeUpdates', '快讯': 'homeNews', '社区精选': 'homeDigest' }[title];
      const expected = source ? title : operation; await main.getByText('栏目非动态 ' + expected, { exact: true }).waitFor();
    }
    assert.equal(labels.length, channels.length + 4);
  });
  await record('carousel activity, topic interest, release timeline and live shortcut open their actual native screens', async () => {
    await home(); await main.getByRole('button', { name: '原生活动横幅', exact: true }).click(); await main.getByRole('heading', { name: '原生活动详情', exact: true }).waitFor(); assert.ok((await callRows()).some(call => call.operation === 'catalogEvent' && call.args.id === '9001'));
    await home(); await main.getByRole('button', { name: '原生兴趣话题 0', exact: true }).click(); await main.getByRole('heading', { name: '原生兴趣话题 0', exact: true, level: 2 }).waitFor(); assert.ok((await callRows()).some(call => call.operation === 'topicDetail' && call.args.tag === '原生兴趣话题 0'));
    await home(); await main.locator('.home-timeline-row').filter({ hasText: '原生测试手机' }).click(); await main.getByRole('heading', { name: '原生测试手机详情', exact: true }).waitFor(); assert.ok((await callRows()).some(call => call.operation === 'catalogProduct' && call.args.id === '9301'));
    await home(); await main.getByRole('button', { name: '原生直播入口', exact: true }).click(); await main.getByRole('heading', { name: '原生直播详情', exact: true }).waitFor(); assert.ok((await callRows()).some(call => call.operation === 'liveDetail' && call.args.id === '9101'));
  });
  await record('top search recognizes official hotSearch and searchTab links and preserves their native search type', async () => {
    const search = page.getByLabel('搜索酷安', { exact: true });
    for (const [url, query, type] of [['/search?type=hotSearch&keyword=AI','AI','all'],['searchTab://topic?keyword=原生话题检索','原生话题检索','feedTopic']]) {
      await search.fill(url); await search.press('Enter'); await main.getByText('搜索结果 ' + query + ' ' + type, { exact: true }).waitFor(); assert.equal(await search.inputValue(), query);
      assert.ok((await callRows()).some(call => call.operation === 'search' && call.args.query === query && call.args.type === type));
    }
    await search.fill('联想搜索'); await page.getByRole('option', { name: '跳转话题热搜', exact: true }).click(); await main.getByText('搜索结果 原生搜索跳转 feedTopic', { exact: true }).waitFor();
  });
  await record('app and game shortcuts only focus empty search, then submit the explicit apk or game type', async () => {
    const search = page.getByLabel('搜索酷安', { exact: true });
    for (const [title, type, query] of [['应用搜索入口','apk','原生应用关键词'],['游戏搜索入口','game','原生游戏关键词']]) {
      await home(); await search.fill('待清空的旧查询'); await search.press('Escape');
      const before = (await callRows()).filter(call => call.operation === 'search').length;
      await main.getByRole('button', { name: title, exact: true }).click();
      assert.equal(await search.inputValue(), ''); assert.equal(await search.evaluate(node => node === document.activeElement), true);
      await search.press('Enter'); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal((await callRows()).filter(call => call.operation === 'search').length, before);
      assert.ok(await main.getByRole('heading', { name: '首页', exact: true }).isVisible());
      await search.fill(query); await search.press('Enter'); await main.getByText('搜索结果 ' + query + ' ' + type, { exact: true }).waitFor();
      const calls = (await callRows()).filter(call => call.operation === 'search'); assert.equal(calls.length, before + 1); assert.equal(calls.at(-1).args.type, type); assert.equal(calls.at(-1).args.query, query);
    }
    assert.ok((await callRows()).filter(call => call.operation === 'search').every(call => typeof call.args.query === 'string' && call.args.query.trim()));
  });
  await record('actual Settings About displays native current version and factual third-party disclaimer', async () => {
    await page.locator('.sidebar-bottom').getByRole('button', { name: '设置', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '设置', exact: true });
    await dialog.getByRole('tab', { name: '关于酷安', exact: true }).click(); await dialog.getByText('版本 ' + packageMetadata.version, { exact: true }).waitFor();
    assert.ok(await dialog.getByText('非官方 Windows 桌面客户端', { exact: true }).isVisible()); assert.match(await dialog.innerText(), /不是酷安官方产品.*无隶属关系/); assert.match(await dialog.innerText(), /不会代做验证码或绕过账号安全检查/);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('synthetic signed-in writer entry seeds article mode and car hashtag without posting', async () => {
    await desktop.evaluate(({ BrowserWindow }) => { const identity = { uid: '77001', username: '隔离首页测试账号', userAvatar: '' }; BrowserWindow.getAllWindows()[0].webContents.send('coolapk:account', { ok: true, data: { accounts: [identity], current: identity } }); });
    await page.locator('.account-entry').getByText('隔离首页测试账号', { exact: true }).waitFor(); await home();
    await main.getByRole('button', { name: /带汽车话题的文章入口/ }).click(); const dialog = page.getByRole('dialog', { name: '发布动态', exact: true });
    await dialog.waitFor(); assert.equal(await dialog.getByRole('tab', { name: '图文文章', exact: true }).getAttribute('aria-selected'), 'true'); assert.equal(await dialog.locator('#publish-message').inputValue(), '#汽车# '); assert.ok(await dialog.getByLabel('文章标题', { exact: true }).isVisible());
    assert.ok(await dialog.getByRole('button', { name: '发布', exact: true }).isDisabled());
    const capture = async () => dialog.evaluate(node => {
      const snapshot = element => {
        const style = getComputedStyle(element), canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const drawing = canvas.getContext('2d'); drawing.fillStyle = style.backgroundColor; drawing.fillRect(0, 0, 1, 1);
        return { className: element.className, opacity: Number(style.opacity), background: style.backgroundColor, backgroundPixel: Array.from(drawing.getImageData(0, 0, 1, 1).data), color: style.color, backdropFilter: style.backdropFilter };
      };
      const ancestors = []; for (let element = node; element; element = element.parentElement) ancestors.push(snapshot(element));
      return { modal: snapshot(node), title: snapshot(node.querySelector('[aria-label="文章标题"]')), editor: snapshot(node.querySelector('#publish-message')), ancestors, animations: node.parentElement.getAnimations({ subtree: true }).map(animation => ({ target: animation.effect?.target?.className || '', state: animation.playState, currentTime: animation.currentTime, progress: animation.effect?.getComputedTiming().progress, finite: Number.isFinite(animation.effect?.getComputedTiming().endTime) })) };
    });
    measurements.composerBeforeAnimationSettles = await capture();
    await dialog.evaluate(async node => { const finite = node.parentElement.getAnimations({ subtree: true }).filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)); await Promise.all(finite.map(animation => animation.finished.catch(() => {}))); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    measurements.composerSteady = await capture();
    assert.ok(measurements.composerSteady.ancestors.every(ancestor => ancestor.opacity >= .999));
    assert.ok(measurements.composerSteady.title.backgroundPixel[3] >= 250); assert.ok(measurements.composerSteady.editor.backgroundPixel[3] >= 250);
    assert.ok(measurements.composerSteady.animations.every(animation => !animation.finite || animation.state === 'finished'));
    await page.screenshot({ path: path.join(directory, 'seeded-article.png') });
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await record('native window resizing preserves content, search access and keyboard focus without document overflow', async () => {
    for (const [width,height] of [[1920,1080],[960,760]]) {
      await desktop.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), { width, height });
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth); assert.ok(await page.getByLabel('搜索酷安', { exact: true }).isVisible());
      await page.keyboard.press('Control+k'); assert.equal(await page.getByLabel('搜索酷安', { exact: true }).evaluate(node => node === document.activeElement), true);
      measurements['resize' + width] = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); await page.screenshot({ path: path.join(directory, 'home-' + width + '.png') });
    }
  });
  assert.deepEqual(errors, []); const counters = await desktop.evaluate(() => structuredClone(globalThis.homeNative));
  assert.deepEqual(counters.blockedWrites, []); assert.deepEqual(counters.unexpectedReads, []); assert.ok(fixtureImageLoads > 0);
  const report = JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'actual built App and native main/preload; synthetic read-only business fixtures; isolated D userdata', checks, errors, measurements, counters: { calls: counters.calls.length, fixtureImageLoads, blockedNetwork: counters.blockedNetwork, blockedWrites: counters.blockedWrites, unexpectedReads: counters.unexpectedReads }, accountScope: 'Synthetic in-memory account event only; no login credentials, live requests, posts or phone actions' }, null, 2) + '\n';
  writeFileSync(path.join(directory, 'checks.json'), report); writeFileSync(path.join(root, 'research/home-native-checks.json'), report);
  console.log(JSON.stringify({ result: 'passed', groups: checks.length, calls: counters.calls.length }));
} catch (failure) {
  if (page) { await page.screenshot({ path: path.join(directory, 'failure.png') }); writeFileSync(path.join(directory, 'failure-state.txt'), await page.locator('body').innerText()); }
  throw failure;
} finally { await desktop.close(); }
