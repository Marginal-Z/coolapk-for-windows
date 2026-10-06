import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const output = '.local/liquid-glass-performance', port = Number(process.env.COOLAPK_GLASS_PERFORMANCE_TEST_PORT || 5292), origin = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/fixture.html`, '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><div id="root"></div><script type="module" src="./fixture.tsx"></script></html>');
writeFileSync(`${output}/fixture.tsx`, `import React,{useLayoutEffect,useState}from'react';import{createRoot}from'react-dom/client';import{createPortal}from'react-dom';import{LiquidGlassDefinitions,LiquidGlassNavigation}from'/src/LiquidGlass.tsx';import'/src/styles.css';import'/src/desktop-effects.css';
function Harness(){const[state,setState]=useState({enabled:true,follow:false,portal:false,budget:false,extra:false});window.__glassUpdate=patch=>setState(previous=>({...previous,...patch}));useLayoutEffect(()=>{const root=document.documentElement;root.dataset.materialEnabled=String(state.enabled);if(state.enabled)root.dataset.materialEffect='full';else delete root.dataset.materialEffect;root.dataset.customBackground='true';root.dataset.materialFollowSystem=String(state.follow)},[state.enabled,state.follow]);useLayoutEffect(()=>{document.getElementById('original-owner').style.setProperty('--glass-refraction','url(#original-owner-optics)','important')},[]);return <><style>{'body{margin:0;overflow:hidden}#fixture-feed{position:fixed;left:210px;top:150px;width:620px;height:510px;overflow:auto;padding:8px}.fixture-card{height:220px;min-height:220px;margin:0 0 16px!important}#fixture-search{position:fixed;left:230px;top:20px;width:540px;height:50px}.sidebar{position:fixed!important;left:0;top:0;width:180px!important;height:700px;padding:20px}.fixture-budget{position:fixed;left:200px;top:160px;display:grid;grid-template-columns:repeat(9,110px);gap:6px;z-index:100;pointer-events:none}:root[data-theme=dark] #fixture-search{border-radius:8px!important}'}</style><aside className="sidebar"><LiquidGlassNavigation label="测试导航" selectionKey="home"><button className="nav-item selected" style={{width:130,height:48}}>首页</button><button className="nav-item" style={{width:130,height:48}}>热榜</button></LiquidGlassNavigation></aside><form id="fixture-search" className="search-box"><input aria-label="搜索测试"/></form><main id="fixture-feed">{state.extra&&<article className="feed-card" id="new-owner" style={{height:180}}>动态加入卡片</article>}{Array.from({length:500},(_,i)=><article className="feed-card fixture-card" key={i} id={i===0?'original-owner':undefined}>只读性能卡片 {i}</article>)}</main>{state.portal&&createPortal(<div className="modal-backdrop"><section className="modal" id="portal-owner" style={{width:420,height:280,minHeight:280}}><article id="nested-owner" className="feed-card" style={{height:80}}>嵌套阅读区域</article></section></div>,document.body)}{state.budget&&createPortal(<div className="fixture-budget">{Array.from({length:45},(_,i)=><article className="feed-card" key={i} style={{width:90+i*2,height:38,margin:0,padding:0}}>有界地图 {i}</article>)}</div>,document.body)}<LiquidGlassDefinitions enabled={state.enabled} followSystem={state.follow}/></>}createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);`);

const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
const checks = [], measurements = {}, errors = []; let browser, page;
const record = async (name, work) => { await work(); checks.push(name); console.log('PASS', name); };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const measured = node => node instanceof HTMLElement && node.matches('.sidebar,.search-box,.feed-card,.modal,.navigation-glass-lens');
    const ownerQuery = selector => typeof selector === 'string' && selector.startsWith('.sidebar,.topbar,');
    const fresh = () => ({ ownerQueries: 0, rectReads: 0, styleReads: 0, filterWrites: 0, mapEncodes: 0 });
    window.__glassMetrics = fresh(); window.__resetGlassMetrics = () => { window.__glassMetrics = fresh(); };
    for (const prototype of [Document.prototype, Element.prototype]) { const query = prototype.querySelectorAll; prototype.querySelectorAll = function (selector) { if (ownerQuery(selector)) window.__glassMetrics.ownerQueries++; return query.call(this, selector); }; }
    const rect = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = function () { if (measured(this)) window.__glassMetrics.rectReads++; return rect.call(this); };
    const style = window.getComputedStyle; window.getComputedStyle = function (node, pseudo) { if (measured(node)) window.__glassMetrics.styleReads++; return style.call(this, node, pseudo); };
    const property = CSSStyleDeclaration.prototype.setProperty; CSSStyleDeclaration.prototype.setProperty = function (name, ...args) { if (name === '--glass-refraction') window.__glassMetrics.filterWrites++; return property.call(this, name, ...args); };
    const encode = HTMLCanvasElement.prototype.toDataURL; HTMLCanvasElement.prototype.toDataURL = function (...args) { window.__glassMetrics.mapEncodes++; return encode.apply(this, args); };
  });
  const media = await context.newCDPSession(page), cpuRate = Number(process.env.COOLAPK_GLASS_PERFORMANCE_CPU_RATE || 1);
  if (cpuRate > 1) await media.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  const accessibility = (transparency = 'no-preference', colors = 'none') => media.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: transparency }, { name: 'forced-colors', value: colors }] });
  await accessibility(); await page.goto(`${origin}/${output}/fixture.html`);
  const settled = () => page.evaluate(() => new Promise(resolve => { let remaining = 5; const tick = () => --remaining ? requestAnimationFrame(tick) : resolve(); requestAnimationFrame(tick); }));
  const measuredOptics = async selector => {
    await page.waitForFunction(selector => { const node = document.querySelector(selector), id = node?.style.getPropertyValue('--glass-refraction').match(/#(coolapk-desktop-glass-\d+)/)?.[1]; return !!id && !!document.getElementById(id)?.querySelector('feImage'); }, selector);
    return page.locator(selector).evaluate(async node => {
      const id = node.style.getPropertyValue('--glass-refraction').match(/#(coolapk-desktop-glass-\d+)/)[1], filter = document.getElementById(id), image = new Image(); image.src = filter.querySelector('feImage').getAttribute('href'); await image.decode();
      return { id, width: node.offsetWidth, height: node.offsetHeight, rasterWidth: image.naturalWidth, rasterHeight: image.naturalHeight, dispersion: !!filter.querySelector('feComposite[in2="green-warp"]') };
    });
  };
  const scrollFrames = (count, delta) => page.evaluate(async ({ count, delta }) => {
    const node = document.getElementById('fixture-feed'); window.__resetGlassMetrics();
    for (let index = 0; index < count; index++) { node.scrollTop += delta; await new Promise(resolve => requestAnimationFrame(resolve)); }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return { ...window.__glassMetrics, frames: count, owners: document.querySelectorAll('.fixture-card').length };
  }, { count, delta });
  await record('500 registered cards retain measured search, shell and dispersive navigation filters with bounded definitions', async () => {
    const optics = await Promise.all(['.sidebar', '#fixture-search', '.navigation-glass-lens', '#original-owner'].map(measuredOptics));
    assert.ok(optics.at(-2).dispersion); assert.equal(optics[1].dispersion, false);
    for (const map of optics) { assert.ok(map.rasterWidth <= 1024 && map.rasterHeight <= 1024 && map.rasterWidth * map.rasterHeight <= 181000); assert.ok(Math.abs((map.width / map.height) / (map.rasterWidth / map.rasterHeight) - 1) < .03); }
    assert.ok(await page.locator('filter[id^="coolapk-desktop-glass-"]').count() <= 40); measurements.initialOptics = optics; await settled();
  });
  await record('60 scroll frames without visibility changes perform zero owner queries, geometry reads, style reads or filter writes', async () => {
    measurements.stableScroll = await scrollFrames(60, .5);
    for (const name of ['ownerQueries', 'rectReads', 'styleReads', 'filterWrites', 'mapEncodes']) assert.equal(measurements.stableScroll[name], 0, JSON.stringify(measurements.stableScroll));
  });
  await record('120 scrolling frames measure newly intersecting cards without scanning all 500 owners per frame', async () => {
    measurements.longScroll = await scrollFrames(120, 8);
    assert.equal(measurements.longScroll.ownerQueries, 0); assert.ok(measurements.longScroll.rectReads > 0 && measurements.longScroll.rectReads < 30, JSON.stringify(measurements.longScroll)); assert.ok(measurements.longScroll.styleReads < 30);
    await page.locator('#fixture-feed').evaluate(node => node.scrollTop = 0); await measuredOptics('#original-owner'); await settled();
  });
  await record('new cards and modal portals gain optics while nested owners skip redundant backdrop passes', async () => {
    await page.evaluate(() => window.__glassUpdate({ extra: true })); await measuredOptics('#new-owner');
    await page.evaluate(() => window.__glassUpdate({ portal: true })); await measuredOptics('#portal-owner'); await settled(); assert.equal(await page.locator('#nested-owner').evaluate(node => node.style.getPropertyValue('--glass-refraction')), '');
    await page.locator('#portal-owner').evaluate(node => node.className = 'plain-wrapper'); await measuredOptics('#nested-owner'); assert.equal(await page.locator('#portal-owner').evaluate(node => node.style.getPropertyValue('--glass-refraction')), '');
    await page.evaluate(() => window.__glassUpdate({ portal: false })); await page.locator('#portal-owner').waitFor({ state: 'detached' }); await settled();
  });
  await record('resize and theme radius changes update measured filters without a document owner rescan', async () => {
    const before = await measuredOptics('#fixture-search'); await settled(); await page.evaluate(() => window.__resetGlassMetrics());
    await page.locator('#fixture-search').evaluate(node => node.style.width = '450px'); await page.waitForFunction(before => document.querySelector('#fixture-search').style.getPropertyValue('--glass-refraction') !== 'url(#' + before + ')', before.id); const resized = await measuredOptics('#fixture-search'); assert.ok(resized.width < before.width);
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark'); await page.waitForFunction(before => document.querySelector('#fixture-search').style.getPropertyValue('--glass-refraction') !== 'url(#' + before + ')', resized.id);
    await settled(); measurements.resizeAndTheme = await page.evaluate(() => window.__glassMetrics); assert.equal(measurements.resizeAndTheme.ownerQueries, 0);
  });
  await record('stop and restart restore original inline values and priority and resume observation without duplicate roots', async () => {
    await page.evaluate(() => window.__glassUpdate({ enabled: false })); await page.waitForFunction(() => document.querySelectorAll('filter[id^="coolapk-desktop-glass-"]').length === 0);
    assert.equal(await page.locator('#original-owner').evaluate(node => node.style.getPropertyValue('--glass-refraction')), 'url(#original-owner-optics)'); assert.equal(await page.locator('#original-owner').evaluate(node => node.style.getPropertyPriority('--glass-refraction')), 'important'); assert.equal(await page.locator('#fixture-search').evaluate(node => node.style.getPropertyValue('--glass-refraction')), '');
    await page.evaluate(() => window.__glassUpdate({ enabled: true })); await measuredOptics('#fixture-search'); assert.equal(await page.locator('.desktop-glass-definitions').count(), 1);
  });
  await record('hidden windows defer geometry work and apply queued changes when visible again', async () => {
    const before = await measuredOptics('#fixture-search'); await settled();
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); window.__resetGlassMetrics(); document.querySelector('#fixture-search').style.width = '430px'; });
    await settled(); measurements.hidden = await page.evaluate(() => window.__glassMetrics); assert.equal(measurements.hidden.rectReads, 0); assert.equal(measurements.hidden.styleReads, 0);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(before => document.querySelector('#fixture-search').style.getPropertyValue('--glass-refraction') !== 'url(#' + before + ')', before.id); await measuredOptics('#fixture-search');
  });
  await record('high contrast and followed reduced transparency restore all overrides while preserving saved material state', async () => {
    await accessibility('no-preference', 'active'); await page.waitForFunction(() => !document.querySelector('#fixture-search').style.getPropertyValue('--glass-refraction')); assert.equal(await page.locator('filter[id^="coolapk-desktop-glass-"]').count(), 0);
    await accessibility('reduce'); await measuredOptics('#fixture-search'); await page.evaluate(() => window.__glassUpdate({ follow: true })); await page.waitForFunction(() => !document.querySelector('#fixture-search').style.getPropertyValue('--glass-refraction'));
    await page.evaluate(() => window.__glassUpdate({ follow: false })); await measuredOptics('#fixture-search'); await accessibility();
  });
  await record('45 distinct visible sizes keep the active SVG definition budget at 40 and filter references valid', async () => {
    await page.evaluate(() => window.__glassUpdate({ budget: true })); await page.waitForFunction(() => document.querySelectorAll('filter[id^="coolapk-desktop-glass-"]').length === 40); await settled();
    const budget = await page.evaluate(() => ({ definitions: document.querySelectorAll('filter[id^="coolapk-desktop-glass-"]').length, missing: [...document.querySelectorAll('.fixture-budget .feed-card')].filter(node => { const id = node.style.getPropertyValue('--glass-refraction').match(/#(coolapk-desktop-glass-\d+)/)?.[1]; return id && !document.getElementById(id); }).length })); assert.equal(budget.missing, 0); measurements.budget = budget;
    await page.evaluate(() => window.__glassUpdate({ budget: false })); await page.locator('.fixture-budget').waitFor({ state: 'detached' }); await settled();
  });
  await record('observer and SVG writes settle without generating idle frame work', async () => {
    await page.evaluate(() => window.__resetGlassMetrics()); await settled(); measurements.idle = await page.evaluate(() => window.__glassMetrics); assert.deepEqual(measurements.idle, { ownerQueries: 0, rectReads: 0, styleReads: 0, filterWrites: 0, mapEncodes: 0 });
  });
  assert.deepEqual(errors, []); await page.screenshot({ path: `${output}/materials.png` });
  writeFileSync(`${output}/checks.json`, JSON.stringify({ checkedAt: new Date().toISOString(), browserOnly: true, cpuRate, checks, measurements, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ result: 'passed', groups: checks.length, measurements }));
} catch (failure) { if (page) { await page.screenshot({ path: `${output}/failure.png` }); writeFileSync(`${output}/failure.json`, JSON.stringify({ checks, measurements, errors, failure: String(failure) }, null, 2)); } throw failure; }
finally { await browser?.close(); await server.close(); }
