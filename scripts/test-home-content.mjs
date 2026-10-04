import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const output = '.local/home-content-check'; mkdirSync(output, { recursive: true });
writeFileSync('.local/home-content-harness.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{HomeContent}from'/src/HomeContent.tsx';import{ChannelManager,savedHomeChannels}from'/src/HomeChannels.tsx';import'/src/styles.css';import'/src/desktop-layout.css';
const nav=(title,type='iconLink')=>({entityType:type,title,url:'/t/'+title,pic:''});const feed=id=>({entityType:'feed',id,uid:'1',username:'公开内容测试',message:'首页动态'+id,dateline:1700000000});const card=(entityTemplate,entities,title='')=>({entityType:'card',entityTemplate,entityId:entityTemplate,entities,title});
window.__restoreSaved=savedHomeChannels;const defaults=[{id:'1',title:'话题',page_fixed:1,page_visibility:'1'},{id:'2',title:'摄影',page_visibility:'1'}];
const rows=[card('imageCarouselCard_1',[nav('活动一','image_1'),nav('活动二','image_1'),nav('活动三','image_1')]),card('iconLinkGridCard',Array.from({length:10},(_,i)=>nav('入口'+i))),card('iconMiniScrollCard',Array.from({length:20},(_,i)=>nav('话题'+i,'topic'))),feed('1'),feed('2'),card('imageTextScrollCard',[feed('3'),feed('4')],'优质图文'),card('futureTemplate',[nav('未来入口')],'其他内容')];
function Harness(){const[blocked,setBlocked]=useState(false),[manager,setManager]=useState(false);const props={onUser:()=>{},onLink:()=>{},onOpen:x=>{window.__homeOpen=x},toast:()=>{},loggedIn:false,onLogin:()=>{},onCollect:()=>{}};window.__homeBlock=setBlocked;return React.createElement('div',null,React.createElement('button',{onClick:()=>setManager(true)},'管理栏目'),React.createElement('main',{className:'main-scroll',style:{height:780,width:'100%',containerType:'inline-size'}},React.createElement(HomeContent,{items:rows,visibleFeed:x=>!blocked||x.id!=='3',openEntity:x=>{window.__homeOpen=x},feedProps:props})),manager&&React.createElement(ChannelManager,{channels:[defaults[1],{...defaults[0],page_visibility:'1'}],defaults,namespace:'fixture',loggedIn:false,onSave:()=>{},onClose:()=>setManager(false),toast:()=>{}}))}createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`);
const port = Number(process.env.COOLAPK_HOME_CONTENT_TEST_PORT || 5270), origin = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
const checks = [], errors = []; let browser;
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/.local/home-content-harness.html`); await page.locator('.home-shortcut').first().waitFor();
  await record('All ten shortcuts and twenty topic/device entries retain native navigation', async () => {
    assert.equal(await page.locator('.home-shortcut').count(), 10); assert.equal(await page.locator('.home-interest').count(), 20);
    await page.getByRole('button', { name: '入口9', exact: true }).click(); assert.equal(await page.evaluate(() => window.__homeOpen.url), '/t/入口9');
    await page.getByRole('button', { name: '话题19', exact: true }).click(); assert.equal(await page.evaluate(() => window.__homeOpen.entityType), 'topic');
  });
  await record('Banner rail supports next group, keyboard activation and all activity destinations', async () => {
    const rail = page.locator('.home-banner-rail'); await page.getByRole('button', { name: '下一组活动' }).click(); assert.ok(await rail.evaluate(node => node.scrollLeft) > 0);
    const target = page.getByRole('button', { name: '活动三', exact: true }); await target.focus(); await page.keyboard.press('Enter'); assert.equal(await page.evaluate(() => window.__homeOpen.title), '活动三');
  });
  await record('Nested feeds preserve grouping, block rules and future layout content', async () => {
    assert.equal(await page.locator('[data-feed-id]').count(), 4); await page.evaluate(() => window.__homeBlock(true)); await page.waitForFunction(() => document.querySelectorAll('[data-feed-id]').length === 3); assert.equal(await page.locator('[data-feed-id="3"]').count(), 0);
    await page.getByRole('button', { name: '未来入口', exact: false }).click(); assert.equal(await page.evaluate(() => window.__homeOpen.url), '/t/未来入口');
  });
  await record('Desktop grid and narrow window remain bounded without horizontal page overflow', async () => {
    assert.equal(await page.locator('.home-content').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 2);
    await page.setViewportSize({ width: 640, height: 850 }); assert.equal(await page.locator('.home-content').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 1);
    assert.ok(await page.locator('.main-scroll').evaluate(node => node.scrollWidth <= node.clientWidth + 1)); await page.screenshot({ path: `${output}/narrow.png` });
  });
  await record('Channel defaults can be restored locally while mandatory official channels stay visible', async () => {
    const restored = await page.evaluate(() => { localStorage.setItem('coolapk-home-channels-old', JSON.stringify([{id:'1',visible:false},{id:'2',visible:false}])); return window.__restoreSaved([{id:'1',title:'话题',page_fixed:1},{id:'2',title:'摄影'}], 'old').map(x => x.page_visibility); }); assert.deepEqual(restored, ['1','0']);
    await page.getByRole('button', { name: '管理栏目', exact: true }).click(); const mandatory = page.getByRole('checkbox', { name: '话题', exact: true }); assert.equal(await mandatory.isDisabled(), true);
    await page.getByRole('button', { name: '恢复默认栏目' }).click(); assert.deepEqual(await page.locator('.home-channel-row label').allTextContents(), ['话题', '摄影']);
    await page.getByRole('button', { name: '保存到本机' }).click(); assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('coolapk-home-channels-fixture'))), [{ id: '1', visible: true }, { id: '2', visible: true }]);
  });
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/checks.json`, JSON.stringify({ checks, errors }, null, 2));
} finally { await browser?.close(); await server.close(); }
