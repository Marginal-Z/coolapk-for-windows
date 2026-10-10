import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const output = '.local/home-content-check'; mkdirSync(output, { recursive: true });
writeFileSync('.local/home-content-harness.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{HomeContent}from'/src/HomeContent.tsx';import{ChannelManager,savedHomeChannels}from'/src/HomeChannels.tsx';import'/src/styles.css';import'/src/desktop-layout.css';
const nav=(title,type='iconLink')=>({entityType:type,title,url:'/t/'+title,pic:location.origin+'/__home-fixture.svg'});const feed=id=>({entityType:'feed',id,uid:'1',username:'公开内容测试',message:'首页动态'+id,dateline:1700000000});const card=(entityTemplate,entities,title='')=>({entityType:'card',entityTemplate,entityId:entityTemplate,entities,title});
window.__restoreSaved=savedHomeChannels;const defaults=[{id:'1',title:'话题',page_fixed:1,page_visibility:'1'},{id:'2',title:'摄影',page_visibility:'1'}];
window.__homeRotationTimers=new Set();const originalInterval=window.setInterval.bind(window),originalClearInterval=window.clearInterval.bind(window);window.setInterval=(work,delay,...args)=>{const id=originalInterval(work,delay,...args);if(delay===5000)window.__homeRotationTimers.add(id);return id};window.clearInterval=id=>{window.__homeRotationTimers.delete(id);originalClearInterval(id)};
const rows=[card('imageCarouselCard_1',[nav('活动一','image_1'),nav('活动二','image_1'),nav('活动三','image_1')]),card('iconLinkGridCard',['值得看','热闻','活动','AI','人像摄影','选机中心','玩机大神','投票','头条榜','官方频道'].map(title=>nav(title))),card('iconMiniScrollCard',Array.from({length:20},(_,i)=>nav('话题'+i,'topic'))),feed('1'),feed('2'),card('imageTextScrollCard',[feed('3'),feed('4')],'优质图文'),card('futureTemplate',[nav('未来入口')],'其他内容')];
function Harness(){const[blocked,setBlocked]=useState(false),[manager,setManager]=useState(false),[bannerCount,setBannerCount]=useState(3);const props={onUser:()=>{},onLink:()=>{},onOpen:x=>{window.__homeOpen=x},toast:()=>{},loggedIn:false,onLogin:()=>{},onCollect:()=>{}};window.__homeBlock=setBlocked;window.__homeBannerCount=setBannerCount;const items=[{...rows[0],entities:rows[0].entities.slice(0,bannerCount)},...rows.slice(1)];return React.createElement('div',null,React.createElement('button',{'aria-label':'刷新当前页'},'刷新'),React.createElement('button',{onClick:()=>setManager(true)},'管理栏目'),React.createElement('main',{className:'main-scroll',style:{height:780,width:'100%',containerType:'inline-size'}},React.createElement(HomeContent,{items,visibleFeed:x=>!blocked||x.id!=='3',openEntity:x=>{window.__homeOpen=x},feedProps:props})),manager&&React.createElement(ChannelManager,{channels:[defaults[1],{...defaults[0],page_visibility:'1'}],defaults,namespace:'fixture',loggedIn:false,onSave:()=>{},onClose:()=>setManager(false),toast:()=>{}}))}createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`);
const port = Number(process.env.COOLAPK_HOME_CONTENT_TEST_PORT || 5270), origin = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
const checks = [], errors = []; let browser, page;
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.route('**/*', route => route.request().url() === origin + '/__home-fixture.svg' ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300"><rect width="900" height="300" fill="#14874e"/><circle cx="450" cy="150" r="100" fill="white"/></svg>' }) : route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.clock.install();
  await page.goto(`${origin}/.local/home-content-harness.html`); await page.locator('.home-shortcut').first().waitFor();
  await page.locator('.main-scroll').evaluate(node => node.parentElement.classList.add('app-shell'));
  await page.addStyleTag({ path: 'src/user-preferences.css' });
  const carousel = page.locator('.home-carousel'), banner = page.locator('.home-banner-rail');
  const outsideControl = page.getByRole('button', { name: '刷新当前页', exact: true });
  const waitRotation = state => page.waitForFunction(value => document.querySelector('.home-carousel')?.getAttribute('data-auto-rotation') === value, state, { polling: 50 });
  const moveOutsideCarousel = async () => {
    // Focus can scroll the document. Move the pointer to a real outside control
    // after focus settles instead of leaving it at a hardcoded viewport point.
    await outsideControl.evaluate(node => node.focus({ preventScroll: true })); await outsideControl.hover();
    await page.waitForFunction(() => { const node = document.querySelector('.home-carousel'); return node && !node.matches(':hover') && !node.contains(document.activeElement); }, undefined, { polling: 50 });
  };
  const waitBannerPosition = expected => page.waitForFunction(value => {
    const node = document.querySelector('.home-banner-rail'), carousel = document.querySelector('.home-carousel');
    if (!node || !carousel || !node.children[value - 1]) return false;
    const target = node.children[value - 1].offsetLeft - node.children[0].offsetLeft;
    return carousel.getAttribute('data-current-banner') === String(value) && Math.abs(node.scrollLeft - target) <= 1;
  }, expected, { polling: 50 });
  // The current-banner attribute rounds the position halfway through a smooth
  // scroll. Wait for its actual destination before advancing the virtual clock.
  const advanceRotation = async expected => { await page.clock.fastForward(5000); await waitBannerPosition(expected); };
  await record('Activity banners rotate automatically through every card and loop back to the first', async () => {
    await moveOutsideCarousel(); await waitRotation('running');
    assert.equal(await carousel.locator('.home-carousel-controls,.home-carousel-position').count(), 0); assert.deepEqual(await carousel.getByRole('button').allTextContents(), ['活动一', '活动二', '活动三']);
    await advanceRotation(2); await advanceRotation(3); await advanceRotation(1);
  });
  await record('Hover keeps mobile-style automatic rotation active while focused links hold their position', async () => {
    await banner.hover(); await waitRotation('running'); await advanceRotation(2); await advanceRotation(3); await advanceRotation(1);
    await moveOutsideCarousel(); await page.getByRole('button', { name: '活动一', exact: true }).focus(); await waitRotation('paused'); await waitBannerPosition(1); await page.clock.fastForward(15000); assert.equal(await carousel.getAttribute('data-current-banner'), '1');
    await moveOutsideCarousel(); await waitRotation('running'); await advanceRotation(2);
  });
  await record('Hidden, offscreen and reduced-motion activity banners do not advance', async () => {
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await waitRotation('paused'); await page.clock.fastForward(15000); assert.equal(await carousel.getAttribute('data-current-banner'), '2');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.emulateMedia({ reducedMotion: 'reduce' }); await waitRotation('paused'); await page.clock.fastForward(15000); assert.equal(await carousel.getAttribute('data-current-banner'), '2');
    await page.locator('.main-scroll').evaluate(node => { node.style.height = '180px'; node.scrollTop = node.scrollHeight; }); await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.waitForFunction(() => { const node = document.querySelector('.home-carousel'), container = document.querySelector('.main-scroll'); return node && container && !matchMedia('(prefers-reduced-motion: reduce)').matches && node.getBoundingClientRect().bottom < container.getBoundingClientRect().top && node.getAttribute('data-auto-rotation') === 'paused'; }, undefined, { polling: 50 }); await page.clock.fastForward(15000); assert.equal(await carousel.getAttribute('data-current-banner'), '2');
    await page.locator('.main-scroll').evaluate(node => { node.style.height = '780px'; node.scrollTop = 0; }); await carousel.scrollIntoViewIfNeeded(); await moveOutsideCarousel();
  });
  await record('Single banners have no rotation timer and multiple banners restart exactly one timer', async () => {
    await page.evaluate(() => window.__homeBannerCount(1)); await page.waitForFunction(() => document.querySelectorAll('.home-banner-rail>.home-banner').length === 1 && window.__homeRotationTimers.size === 0); await waitBannerPosition(1); await waitRotation('paused');
    await page.clock.fastForward(20000); assert.equal(await carousel.getAttribute('data-current-banner'), '1'); assert.equal(await page.evaluate(() => window.__homeRotationTimers.size), 0);
    await page.evaluate(() => window.__homeBannerCount(3)); await page.waitForFunction(() => document.querySelectorAll('.home-banner-rail>.home-banner').length === 3 && window.__homeRotationTimers.size === 1); await waitRotation('running'); await advanceRotation(2);
  });
  await record('Vertical mouse-wheel scrolling over the automatic carousel continues into the feed', async () => {
    const handled = await banner.evaluate(node => { const wheel = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }); node.dispatchEvent(wheel); return wheel.defaultPrevented; }); assert.equal(handled, false);
  });
  await record('All ten shortcuts and twenty topic/device entries retain native navigation', async () => {
    assert.equal(await page.locator('.home-shortcut').count(), 10); assert.equal(await page.locator('.home-interest').count(), 20);
    await page.getByRole('button', { name: '官方频道', exact: true }).click(); assert.equal(await page.evaluate(() => window.__homeOpen.url), '/t/官方频道');
    await page.getByRole('button', { name: '话题19', exact: true }).click(); assert.equal(await page.evaluate(() => window.__homeOpen.entityType), 'topic');
  });
  await record('Homepage interest cards stay in one horizontally scrollable row at desktop and narrow widths', async () => {
    for (const width of [1400, 900, 640, 480]) {
      await page.setViewportSize({ width, height: 850 });
      const layout = await page.locator('.home-interest-grid').evaluate(node => ({ display: getComputedStyle(node).display, wrap: getComputedStyle(node).flexWrap, width: node.clientWidth, scrollWidth: node.scrollWidth, tops: Array.from(node.children, child => Math.round(child.getBoundingClientRect().top)), count: node.children.length }));
      assert.equal(layout.display, 'flex'); assert.equal(layout.wrap, 'nowrap'); assert.equal(layout.count, 20); assert.ok(layout.scrollWidth > layout.width); assert.equal(new Set(layout.tops).size, 1);
    }
    await page.setViewportSize({ width: 1400, height: 850 });
  });
  await record('Every banner remains reachable by keyboard without manual paging controls', async () => {
    for (const [index, title] of ['活动一', '活动二', '活动三'].entries()) {
      const target = page.getByRole('button', { name: title, exact: true }); await target.focus(); await waitBannerPosition(index + 1); await waitRotation('paused'); await page.keyboard.press('Enter'); assert.equal(await page.evaluate(() => window.__homeOpen.title), title);
    }
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
  await record('All shortcut icons fit one compact row at desktop and narrow widths without pagination', async () => {
    for (const width of [1400, 900, 640, 480]) {
      await page.setViewportSize({ width, height: 850 });
      const compact = await page.locator('.home-shortcuts').evaluate(node => ({ width: node.clientWidth, scrollWidth: node.scrollWidth, tops: Array.from(node.children, child => child.getBoundingClientRect().top), bounds: Array.from(node.children, child => ({ left: child.getBoundingClientRect().left, right: child.getBoundingClientRect().right })), left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right }));
      assert.equal(new Set(compact.tops).size, 1); assert.ok(compact.scrollWidth <= compact.width + 1); assert.ok(compact.bounds.every(tile => tile.left >= compact.left - 1 && tile.right <= compact.right + 1 && tile.right - tile.left <= 83));
      assert.equal(await page.locator('.home-shortcuts-section .home-carousel-controls').count(), 0); assert.equal(await page.locator('.home-shortcut').count(), 10);
      if (width === 1400 || width === 640) await page.locator('.home-shortcuts-section').screenshot({ path: `${output}/shortcuts-${width}.png` });
    }
    await page.getByRole('button', { name: '官方频道', exact: true }).focus(); await page.keyboard.press('Enter'); assert.equal(await page.evaluate(() => window.__homeOpen.url), '/t/官方频道');
  });
  await record('Channel defaults can be restored locally while mandatory official channels stay visible', async () => {
    const restored = await page.evaluate(() => { localStorage.setItem('coolapk-home-channels-old', JSON.stringify([{id:'1',visible:false},{id:'2',visible:false}])); return window.__restoreSaved([{id:'1',title:'话题',page_fixed:1},{id:'2',title:'摄影'}], 'old').map(x => x.page_visibility); }); assert.deepEqual(restored, ['1','0']);
    await page.getByRole('button', { name: '管理栏目', exact: true }).click(); const mandatory = page.getByRole('checkbox', { name: '话题', exact: true }); assert.equal(await mandatory.isDisabled(), true);
    await page.getByRole('button', { name: '恢复默认栏目' }).click(); assert.deepEqual(await page.locator('.home-channel-row label').allTextContents(), ['话题', '摄影']);
    await page.getByRole('button', { name: '保存到本机' }).click(); assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('coolapk-home-channels-fixture'))), [{ id: '1', visible: true }, { id: '2', visible: true }]);
  });
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/checks.json`, JSON.stringify({ checks, errors }, null, 2));
} catch (failure) {
  const state = await page?.evaluate(() => {
    const carousel = document.querySelector('.home-carousel'), rail = document.querySelector('.home-banner-rail'), active = document.activeElement;
    return { rotation: carousel?.getAttribute('data-auto-rotation'), banner: carousel?.getAttribute('data-current-banner'), hover: carousel?.matches(':hover'), focusInside: Boolean(carousel?.contains(active)), activeLabel: active?.getAttribute('aria-label') || active?.textContent, rotationTimerCount: window.__homeRotationTimers.size, hidden: document.hidden, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, scrollLeft: rail?.scrollLeft, bannerPositions: rail ? Array.from(rail.children, child => child.offsetLeft - rail.children[0].offsetLeft) : [], carouselBounds: carousel?.getBoundingClientRect().toJSON() };
  }).catch(() => null);
  console.error('HOME TEST FAILURE STATE', JSON.stringify({ completedChecks: checks, state, errors }));
  writeFileSync(`${output}/failure.json`, JSON.stringify({ completedChecks: checks, state, errors, failure: String(failure) }, null, 2));
  throw failure;
} finally { await browser?.close(); await server.close(); }
