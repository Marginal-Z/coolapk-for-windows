import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

mkdirSync('.local/article-check', { recursive: true });
writeFileSync('.local/article-harness.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';import{FeedManager}from'/src/Collections.tsx';import{FeedCard}from'/src/components.tsx';import'/src/styles.css';
function Harness(){const[mode,setMode]=useState('read'),[feed,setFeed]=useState(window.__articleMock.article);useEffect(()=>{window.__articleNavigate=(next,id)=>{setFeed(window.__articleMock[id]);setMode(next)}},[]);const props={loggedIn:true,accountUid:'42',onUser:()=>{},onOpen:()=>{},onLogin:()=>{},onLink:()=>{},onForward:()=>{},toast:()=>{}};return React.createElement('main',{style:{maxWidth:'900px',margin:'auto',padding:'24px'}},mode==='read'?React.createElement(FeedCard,{feed,...props,detailed:true}):React.createElement(FeedManager,{key:feed.id,feed,namespace:'42',onClose:()=>setMode('read'),onDone:()=>{window.__articleDone=true;setMode('read')},toast:()=>{}}))};createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
</script></body></html>`);
const port = Number(process.env.COOLAPK_ARTICLE_TEST_PORT || 5179), origin = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser; const checks = [], errors = [];
async function record(title, test) { await test(); checks.push(title); console.log('PASS', title); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1300, height: 920 }, bypassCSP: true });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const preserved = { type: 'card', title: '完整保留卡片', url: 'https://www.coolapk.com/feed/7', metadata: { id: 7, nested: ['a', { key: 'value' }] } };
    const article = { entityType: 'feed', id: '601', uid: '42', username: '模拟本人', isHtmlArticle: 1, messageTitle: '独立标题', messageCover: 'https://image.coolapk.com/feed/cover.png', message: JSON.stringify([{ type: 'top', description: '旧题图标题', url: 'https://image.coolapk.com/feed/old.png' }, { type: 'text', message: '<h2>模型正文</h2><script>window.__articleExecuted=true</script>' }, { type: 'image', url: 'https://image.coolapk.com/feed/original.png', description: '原始图片' }, preserved, { type: 'bottom', data: 'non-body' }, { type: 'relativeInfo', data: 'non-body' }]) };
    const unknown = { ...article, id: '602', message: JSON.stringify([{ type: 'text', message: '可读正文' }, { type: 'new-server-model', title: '未适配内容' }]) };
    const ordinary = { entityType: 'feed', id: '603', uid: '42', username: '模拟本人', message: '普通动态原文', pic: 'https://image.coolapk.com/feed/ordinary.png' };
    const video = { ...ordinary, id: '604', mediaType: 2, mediaUrl: 'https://video.coolapk.com/video/original.mp4' };
    const mock = window.__articleMock = { article, unknown, ordinary, video, preserved, calls: [], failOnce: '', deferEditable: false, pendingEditable: [] };
    window.coolapk = { verify: async () => ({ ok: true, data: {} }), openExternal: async () => ({ ok: true, data: {} }), call: async (operation, args = {}) => {
      mock.calls.push({ operation, args: operation === 'uploadImage' ? { ...args, bytes: args.bytes.length } : structuredClone(args) });
      if (mock.failOnce === operation) { mock.failOnce = ''; return { ok: false, error: { code: 'VERIFY_REQUIRED', message: '模拟人工验证', verificationId: 'synthetic-article' } }; }
      if (operation === 'editableFeed') {
        const data = structuredClone(Object.values(mock).find(value => value?.id === args.id));
        if (mock.deferEditable) await new Promise(resolve => mock.pendingEditable.push(resolve));
        return { ok: true, data: { data } };
      }
      if (operation === 'uploadImage') return { ok: true, data: { data: 'https://image.coolapk.com/feed/added.png' } };
      if (operation === 'editArticle' || operation === 'action') return { ok: true, data: { data: { id: args.id } } };
      return { ok: true, data: { data: [] } };
    } };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(origin + '/.local/article-harness.html');
  await record('official model arrays render safely instead of displaying raw JSON', async () => {
    await page.getByText('模型正文', { exact: true }).waitFor(); await page.getByText('完整保留卡片', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-article-model-type="text"]').count(), 1); assert.equal(await page.locator('[data-article-model-type="image"]').count(), 1);
    assert.equal(await page.evaluate(() => window.__articleExecuted), undefined);
    assert.ok(!(await page.locator('main').innerText()).includes('"type"'));
    await page.screenshot({ path: '.local/article-check/read.png' });
  });
  await record('article editing preserves model order, nested cards, separate title/cover and captcha payload', async () => {
    await page.evaluate(() => window.__articleNavigate('edit', 'article')); await page.getByRole('button', { name: '编辑我的动态', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '管理动态' }); await dialog.getByRole('textbox', { name: '文章标题', exact: true }).waitFor();
    assert.equal(await dialog.getByRole('textbox', { name: '文章标题', exact: true }).inputValue(), '独立标题');
    assert.equal(await dialog.getByRole('textbox', { name: '文章封面地址', exact: true }).inputValue(), 'https://image.coolapk.com/feed/cover.png');
    await dialog.getByRole('textbox', { name: '段落 1 内容' }).fill('修改后的文字'); await dialog.getByRole('button', { name: '上移段落 2', exact: true }).click();
    const canvasPng = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2; canvas.getContext('2d').fillRect(0, 0, 2, 2); return canvas.toDataURL().split(',')[1]; });
    const input = dialog.locator('input[type=file]'); await input.setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(canvasPng, 'base64') });
    await dialog.getByRole('button', { name: '将图片加入正文', exact: true }).click(); await dialog.getByRole('textbox', { name: '图片 4 说明', exact: true }).waitFor();
    await dialog.getByRole('textbox', { name: '图片 4 说明', exact: true }).fill('新增说明'); await dialog.getByRole('textbox', { name: '文章标题', exact: true }).fill('修改后的标题');
    await page.screenshot({ path: '.local/article-check/edit.png' });
    await page.evaluate(() => { window.__articleMock.failOnce = 'editArticle'; }); await dialog.getByRole('button', { name: '保存文章', exact: true }).click(); await dialog.getByRole('button', { name: '完成验证', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    const { calls, preserved } = await page.evaluate(() => ({ calls: window.__articleMock.calls.filter(call => call.operation === 'editArticle'), preserved: window.__articleMock.preserved }));
    assert.equal(calls.length, 2); assert.deepEqual(calls[0].args, calls[1].args); const payload = calls[1].args;
    assert.equal(payload.title, '修改后的标题'); assert.equal(payload.cover, 'https://image.coolapk.com/feed/cover.png'); assert.deepEqual(payload.models.map(model => model.type), ['image', 'text', 'card', 'image']);
    assert.equal(payload.models[1].message, '修改后的文字'); assert.deepEqual(payload.models[2], preserved); assert.equal(payload.models[3].url, 'https://image.coolapk.com/feed/added.png'); assert.equal(payload.models[3].description, '新增说明');
  });
  await record('unknown models remain readable and block editing before any write', async () => {
    await page.evaluate(() => window.__articleNavigate('read', 'unknown')); await page.getByText('未适配内容', { exact: true }).waitFor();
    await page.evaluate(() => window.__articleNavigate('edit', 'unknown')); await page.getByRole('button', { name: '编辑我的动态', exact: true }).click();
    await page.getByText('原文包含无法编辑的文章模型，已停止保存以保留完整内容。', { exact: true }).waitFor(); assert.ok(await page.getByRole('button', { name: '保存文章', exact: true }).isDisabled());
    assert.ok(await page.evaluate(() => !window.__articleMock.calls.some(call => call.operation === 'editArticle' && call.args.id === '602')));
  });
  await record('ordinary dynamic edits retain their contract and video edits are unavailable', async () => {
    await page.evaluate(() => window.__articleNavigate('edit', 'ordinary')); await page.getByRole('button', { name: '编辑我的动态', exact: true }).click();
    await page.getByRole('textbox', { name: '编辑动态内容', exact: true }).fill('普通动态修改');
    await page.evaluate(() => { window.__articleMock.failOnce = 'action'; });
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    assert.ok(await page.getByRole('textbox', { name: '编辑动态内容', exact: true }).isDisabled());
    await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.getByRole('dialog', { name: '管理动态' }).waitFor({ state: 'hidden' });
    const requests = await page.evaluate(() => window.__articleMock.calls.filter(call => call.operation === 'action' && call.args.id === '603'));
    assert.equal(requests.length, 2); assert.deepEqual(requests[0].args, requests[1].args); assert.deepEqual(requests[1].args, { type: 'editFeed', id: '603', message: '普通动态修改', pic: 'https://image.coolapk.com/feed/ordinary.png' });
    await page.evaluate(() => window.__articleNavigate('edit', 'video')); await page.getByRole('button', { name: '编辑我的动态', exact: true }).click(); await page.getByText('视频动态的修改协议尚未确认，请通过手机协同编辑。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '保存修改', exact: true }).count(), 0); assert.equal(await page.getByRole('button', { name: '保存文章', exact: true }).count(), 0);
  });
  await record('cached ordinary edits wait for current content and refresh never overwrites typed drafts', async () => {
    await page.evaluate(() => {
      window.__articleMock.deferEditable = true;
      window.__articleMock.ordinary.message = '重新获取的动态原文';
      window.__articleNavigate('edit', 'ordinary');
    });
    await page.getByRole('button', { name: '编辑我的动态', exact: true }).click();
    const field = page.getByRole('textbox', { name: '编辑动态内容', exact: true });
    const save = page.getByRole('button', { name: '保存修改', exact: true });
    await page.waitForFunction(() => window.__articleMock.pendingEditable.length > 0);
    assert.ok(await field.isDisabled()); assert.ok(await save.isDisabled());
    assert.equal(await page.evaluate(() => window.__articleMock.calls.filter(call => call.operation === 'action' && call.args.id === '603').length), 2);
    // Observe the value at the first enabled DOM commit, before an effect could rewrite it after input begins.
    await page.evaluate(() => {
      const capture = () => {
        const field = document.querySelector('textarea[aria-label="编辑动态内容"]');
        if (field && !field.disabled) { window.__articleFirstEnabledValue = field.value; observer.disconnect(); }
      };
      const observer = new MutationObserver(capture); observer.observe(document.body, { subtree: true, childList: true, attributes: true });
      window.__articleMock.pendingEditable.splice(0).forEach(resolve => resolve());
    });
    await page.waitForFunction(() => window.__articleFirstEnabledValue !== undefined);
    assert.equal(await page.evaluate(() => window.__articleFirstEnabledValue), '重新获取的动态原文');
    await field.fill('即时输入的修改');
    await page.evaluate(() => window.dispatchEvent(new Event('coolapk:refresh-resources')));
    await page.waitForFunction(() => window.__articleMock.pendingEditable.length > 0);
    assert.ok(await field.isDisabled()); assert.ok(await save.isDisabled());
    await page.evaluate(() => window.__articleMock.pendingEditable.splice(0).forEach(resolve => resolve()));
    await page.waitForFunction(() => !document.querySelector('textarea[aria-label="编辑动态内容"]').disabled);
    assert.equal(await field.inputValue(), '即时输入的修改');
    await save.click(); await page.getByRole('dialog', { name: '管理动态' }).waitFor({ state: 'hidden' });
    const request = await page.evaluate(() => window.__articleMock.calls.filter(call => call.operation === 'action' && call.args.id === '603').at(-1));
    assert.deepEqual(request.args, { type: 'editFeed', id: '603', message: '即时输入的修改', pic: 'https://image.coolapk.com/feed/ordinary.png' });
    await page.evaluate(() => { window.__articleMock.deferEditable = false; });
  });
  await record('cached articles initialize from current content and retain drafts through refresh failure and retry', async () => {
    await page.evaluate(() => {
      const mock = window.__articleMock; mock.deferEditable = true;
      mock.article.messageTitle = '服务器新标题'; mock.article.messageCover = 'https://image.coolapk.com/feed/current.png';
      mock.article.message = JSON.stringify([{ type: 'text', message: '服务器新正文' }, mock.preserved]);
      window.__articleNavigate('edit', 'article');
    });
    await page.getByRole('button', { name: '编辑我的动态', exact: true }).click();
    await page.waitForFunction(() => window.__articleMock.pendingEditable.length > 0);
    assert.equal(await page.getByRole('textbox', { name: '文章标题', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '保存文章', exact: true }).count(), 0);
    await page.evaluate(() => window.__articleMock.pendingEditable.splice(0).forEach(resolve => resolve()));
    const title = page.getByRole('textbox', { name: '文章标题', exact: true });
    const cover = page.getByRole('textbox', { name: '文章封面地址', exact: true });
    const paragraph = page.getByRole('textbox', { name: '段落 1 内容', exact: true });
    const save = page.getByRole('button', { name: '保存文章', exact: true });
    await title.waitFor(); assert.equal(await title.inputValue(), '服务器新标题'); assert.equal(await cover.inputValue(), 'https://image.coolapk.com/feed/current.png'); assert.equal(await paragraph.inputValue(), '服务器新正文');
    await title.fill('我的文章标题草稿'); await paragraph.fill('我的文章正文草稿');
    await page.evaluate(() => {
      window.__articleMock.article.messageTitle = '刷新返回的标题';
      window.__articleMock.article.message = JSON.stringify([{ type: 'text', message: '刷新返回的正文' }]);
      window.dispatchEvent(new Event('coolapk:refresh-resources'));
    });
    await page.waitForFunction(() => window.__articleMock.pendingEditable.length > 0);
    assert.ok(await title.isDisabled()); assert.ok(await paragraph.isDisabled()); assert.ok(await save.isDisabled());
    await page.evaluate(() => window.__articleMock.pendingEditable.splice(0).forEach(resolve => resolve()));
    await page.waitForFunction(() => !document.querySelector('input[aria-label="文章标题"]').disabled);
    assert.equal(await title.inputValue(), '我的文章标题草稿'); assert.equal(await paragraph.inputValue(), '我的文章正文草稿');
    await page.evaluate(() => { window.__articleMock.failOnce = 'editableFeed'; window.dispatchEvent(new Event('coolapk:refresh-resources')); });
    await page.getByText('模拟人工验证', { exact: true }).waitFor();
    assert.ok(await title.isDisabled()); assert.ok(await save.isDisabled());
    assert.equal(await title.inputValue(), '我的文章标题草稿');
    await page.getByRole('button', { name: '完成验证', exact: true }).click();
    await page.waitForFunction(() => window.__articleMock.pendingEditable.length > 0);
    assert.ok(await save.isDisabled());
    await page.evaluate(() => window.__articleMock.pendingEditable.splice(0).forEach(resolve => resolve()));
    await page.waitForFunction(() => !document.querySelector('input[aria-label="文章标题"]').disabled);
    await save.click(); await page.getByRole('dialog', { name: '管理动态' }).waitFor({ state: 'hidden' });
    const { request, preserved } = await page.evaluate(() => ({ request: window.__articleMock.calls.filter(call => call.operation === 'editArticle' && call.args.id === '601').at(-1), preserved: window.__articleMock.preserved }));
    assert.equal(request.args.title, '我的文章标题草稿'); assert.equal(request.args.cover, 'https://image.coolapk.com/feed/current.png');
    assert.deepEqual(request.args.models, [{ type: 'text', message: '我的文章正文草稿' }, preserved]);
    await page.evaluate(() => { window.__articleMock.deferEditable = false; });
  });
  assert.deepEqual(errors, []); writeFileSync('research/article-checks.json', JSON.stringify({ mode: 'synthetic renderer contract checks', externalRequests: 'blocked', checks, errors }, null, 2));
} finally { await browser?.close(); await server.close(); }
