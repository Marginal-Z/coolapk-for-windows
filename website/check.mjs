import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const origin = 'http://127.0.0.1:5294';
const output = new URL('./qa/', import.meta.url); mkdirSync(output, { recursive:true });
const html = readFileSync(new URL('./dist/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('./dist/styles.css', import.meta.url), 'utf8');
for (const [,asset] of html.matchAll(/(?:src|href)="((?:assets\/|styles\.css|site\.js)[^"]*)"/g)) assert.ok(existsSync(new URL('./dist/'+asset, import.meta.url)), asset);
for (const [,asset] of css.matchAll(/url\(['"]?(assets\/[^'")]+)/g)) assert.ok(existsSync(new URL('./dist/'+asset, import.meta.url)), asset);
const browser = await chromium.launch({ headless:true, channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome' });
const checks = [], errors = [];
try {
  const context = await browser.newContext({ viewport:{ width:1440,height:1000 } });
  let releaseVersion='9.4.2';
  const makeRelease=version=>({tag_name:'v'+version,draft:false,prerelease:false,html_url:'https://github.com/Z-YO-YI/coolapk-for-windows/releases/tag/v'+version,assets:[['installer','Coolapk-Desktop-Setup-'+version+'-x64.exe'],['portable','Coolapk-Desktop-'+version+'-x64.exe']].map(([kind,name])=>({name,state:'uploaded',size:111645050,browser_download_url:'https://github.com/Z-YO-YI/coolapk-for-windows/releases/download/v'+version+'/'+name}))});
  await context.route('**/*', route => route.request().url().startsWith(origin+'/') ? route.continue() : route.request().url()==='https://api.github.com/repos/Z-YO-YI/coolapk-for-windows/releases/latest' ? route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(makeRelease(releaseVersion))}) : route.abort());
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil:'networkidle' });
  assert.equal(await page.title(), 'coolapk desktop｜酷安 Windows 桌面客户端');
  assert.equal(await page.locator('#hero-title').innerText(), '酷安 Windows\n桌面客户端');
  assert.equal(await page.getByRole('heading', {name:'主要功能', exact:true}).count(), 1);
  assert.equal(await page.locator('.hero-waves path').count(), 6);
  assert.equal(await page.locator('h1').count(), 1);
  for (const id of ['main','features','screenshots','appearance','faq','download']) assert.equal(await page.locator('#'+id).count(),1);
  assert.match(await page.locator('.download-installer').getAttribute('href'), /releases\/download\/v9\.4\.2\/Coolapk-Desktop-Setup-9\.4\.2-x64\.exe$/);
  assert.match(await page.locator('.download-portable').getAttribute('href'), /releases\/download\/v9\.4\.2\/Coolapk-Desktop-9\.4\.2-x64\.exe$/);
  assert.equal(await page.locator('#updates').count(),0);
  assert.equal(await page.getByRole('link',{name:/更新日志/}).count(),0);
  releaseVersion='10.0.0';await page.reload({waitUntil:'networkidle'});
  assert.match(await page.locator('.download-installer').getAttribute('href'), /v10\.0\.0\/Coolapk-Desktop-Setup-10\.0\.0-x64\.exe$/);
  assert.equal(await page.locator('[data-release-version]').first().innerText(),'v10.0.0');
  const fallback=await browser.newContext();await fallback.route('**/api.github.com/**',route=>route.fulfill({status:429,body:'rate limit'}));
  const fallbackPage=await fallback.newPage();await fallbackPage.goto(origin,{waitUntil:'networkidle'});
  assert.equal(await fallbackPage.locator('.download-installer').getAttribute('href'),'https://github.com/Z-YO-YI/coolapk-for-windows/releases/latest');
  assert.match(await fallbackPage.locator('.release-status').innerText(),/暂时无法读取/);await fallback.close();
  const noJs=await browser.newContext({javaScriptEnabled:false});const noJsPage=await noJs.newPage();await noJsPage.goto(origin);
  assert.equal(await noJsPage.locator('.download-installer').getAttribute('href'),'https://github.com/Z-YO-YI/coolapk-for-windows/releases/latest');await noJs.close();
  checks.push('section anchors, metadata and verified package links');
  for (const tab of await page.getByRole('tab').all()) {
    await tab.click();
    const key=await tab.getAttribute('data-shot');
    assert.equal(await tab.getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#screenshot-panel').getAttribute('aria-labelledby'),await tab.getAttribute('id'));
    assert.equal(await page.locator('#screenshot').getAttribute('src'),'assets/'+key+'.png');
    await page.locator('#screenshot').evaluate(image=>image.decode());
  }
  await page.getByRole('tab',{name:'社区浏览',exact:true}).click();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab',{name:'首页',exact:true}).getAttribute('aria-selected'),'true');
  await page.keyboard.press('End');
  assert.equal(await page.getByRole('tab',{name:'个性化设置',exact:true}).getAttribute('aria-selected'),'true');
  await page.locator('.screenshot-open').click();
  const galleryDialog=page.getByRole('dialog',{name:'客户端界面大图',exact:true});
  await galleryDialog.waitFor();
  assert.equal(await galleryDialog.locator('img').getAttribute('src'),'assets/settings.png');
  await galleryDialog.getByRole('button',{name:'关闭大图',exact:true}).click();
  assert.equal(await galleryDialog.isVisible(),false);
  await page.locator('.preview-expand').click();await galleryDialog.waitFor();
  await page.keyboard.press('Escape');assert.equal(await galleryDialog.isVisible(),false);
  await page.waitForFunction(()=>!document.body.classList.contains('dialog-open'));
  assert.equal(await page.locator('body').evaluate(node=>node.classList.contains('dialog-open')),false);
  await page.getByRole('tab',{name:'社区浏览',exact:true}).click();
  checks.push('seven decoded real screenshots, keyboard tabs and image close button/Escape');
  const demo = page.locator('.material-demo'), switcher = page.getByRole('switch',{name:'启用官网材质示意'});
  const materialBackgrounds = [];
  for (const [label,value] of [['液态玻璃','glass'],['背景模糊','blur'],['半透明','transparent']]) {
    await page.getByRole('radio',{name:label,exact:true}).check();
    assert.equal(await demo.getAttribute('data-material'),value);
    await page.waitForTimeout(300);
    materialBackgrounds.push(await demo.locator('.material-panel').evaluate(node=>getComputedStyle(node).backgroundColor));
  }
  assert.equal(new Set(materialBackgrounds).size,3,JSON.stringify(materialBackgrounds));
  await switcher.uncheck(); assert.equal(await demo.getAttribute('data-material'),'disabled');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.material-panel')).backgroundColor==='rgb(255, 255, 255)');
  assert.equal(await demo.locator('.material-panel').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(255, 255, 255)');
  await switcher.check(); assert.equal(await demo.getAttribute('data-material'),'transparent');
  await page.getByRole('radio',{name:'液态玻璃',exact:true}).check();
  checks.push('three distinct material demonstrations and reversible master switch');
  await page.getByText('这是酷安官方客户端吗？',{exact:true}).click();
  assert.equal(await page.locator('details').first().getAttribute('open'),'');
  checks.push('FAQ interaction and third-party disclosure');
  for (const [width,height] of [[1920,1080],[1440,1000],[768,1024],[390,844],[320,740],[720,500]]) {
    await page.setViewportSize({width,height});
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.evaluate(async()=>{await Promise.all([...document.images].map(image=>{image.loading='eager';return image.decode();}));});
    const layout = await page.evaluate(()=>({
      viewport:innerWidth,scroll:document.documentElement.scrollWidth,
      images:[...document.images].map(image=>({loaded:image.complete&&image.naturalWidth>0,src:image.getAttribute('src')})),
      overlapping:(()=>{const brand=document.querySelector('.site-header .brand').getBoundingClientRect(),nav=document.querySelector('.site-header nav').getBoundingClientRect();return brand.right>nav.left+1&&Math.min(brand.bottom,nav.bottom)>Math.max(brand.top,nav.top);})()
    }));
    assert.ok(layout.scroll<=layout.viewport+1,JSON.stringify({width,...layout}));
    assert.equal(layout.overlapping,false,'header controls must not overlap at '+width);
    assert.ok(layout.images.every(image=>image.loaded));
    if(width===1440||width===390) {await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})));});await page.screenshot({ path:fileURLToPath(new URL(`website-${width}.png`,output)),fullPage:true });await page.screenshot({ path:fileURLToPath(new URL(`hero-${width}.png`,output)) });}
    checks.push('responsive layout and decoded assets at '+width+'px');
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'auto');
  const keyboardPage = await context.newPage(); await keyboardPage.goto(origin);
  await keyboardPage.keyboard.press('Tab');
  assert.equal(await keyboardPage.evaluate(()=>document.activeElement.textContent.trim()),'跳到正文');
  await keyboardPage.keyboard.press('Enter'); assert.equal(new URL(keyboardPage.url()).hash,'');
  await keyboardPage.close();
  checks.push('reduced motion and keyboard entry');
  for (const width of [1440,390,320]) {
    await page.setViewportSize({width,height:1000});
    await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
    assert.equal(overflow,false,'200% text size must not overflow at '+width);
    await page.evaluate(()=>{document.documentElement.style.fontSize='';});
  }
  checks.push('200% text enlargement without horizontal overflow');
  assert.deepEqual(errors,[]);
  const report={checkedAt:new Date().toISOString(),checks,errors}; writeFileSync(new URL('checks.json',output),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
