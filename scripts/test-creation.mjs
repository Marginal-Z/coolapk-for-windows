import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
mkdirSync('.local/creation-check', { recursive: true });
writeFileSync('.local/creation-harness.html', `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{CreationDialog}from'/src/Creation.tsx';import'/src/styles.css';
function Harness(){const[view,setView]=useState({kind:'poll',namespace:'synthetic-A',loggedIn:true,open:true});useEffect(()=>{window.__creationNavigate=value=>setView(previous=>({...previous,...value,open:true}))},[]);return React.createElement('main',null,view.open?React.createElement(CreationDialog,{...view,onLogin:()=>window.__creationLogin=true,onClose:()=>setView(previous=>({...previous,open:false})),onCreated:feed=>{window.__creationCreated={feed,namespace:view.namespace};setView(previous=>({...previous,open:false}))},onOpenQuestion:id=>window.__creationQuestion=id,toast:value=>window.__creationToast=value}):React.createElement('p',null,'窗口已关闭'))}createRoot(document.getElementById('root')).render(React.createElement(Harness));
</script></body></html>`);
const port = Number(process.env.COOLAPK_CREATION_TEST_PORT || 5251), origin = `http://127.0.0.1:${port}`;
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
const checks = [], errors = []; let browser;
async function record(name, work) { await work(); checks.push(name); console.log('PASS', name); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1180, height: 920 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const mock = window.__creationMock = { calls: [], failure: '', hold: '', release: null, verifyHeld: false, releaseVerify: null, nextId: 701 };
    window.coolapk = {
      verify: async () => { if (mock.verifyHeld) await new Promise(resolve => { mock.releaseVerify = resolve; }); mock.failure = ''; return { ok: true, data: {} }; },
      call: async (operation, args) => {
        mock.calls.push({ operation, args: structuredClone(args) });
        if (mock.hold === operation) await new Promise(resolve => { mock.release = resolve; });
        if (operation === 'relatedQuestions') return { ok: true, data: { data: [{ id: '401', messageTitle: '模拟相似问题？' }] } };
        if (operation === 'catalogDyhEditing' || operation === 'searchPublishTopics' || operation === 'search') return { ok: true, data: { data: [] } };
        if (operation === 'uploadImage') return { ok: true, data: { data: 'https://image.coolapk.com/feed/synthetic-test.png' } };
        if (!['questionCreate', 'pollCreate'].includes(operation)) throw new Error('Unexpected operation ' + operation);
        if (mock.failure === 'verify') return { ok: false, error: { code: 'VERIFY_REQUIRED', message: '模拟发布验证码', verificationId: 'synthetic-creation-challenge' } };
        if (mock.failure === 'uncertain') { mock.failure = ''; return { ok: false, error: { code: 'WRITE_UNCONFIRMED', message: '模拟提交结果未确认' } }; }
        return { ok: true, data: { data: { id: String(mock.nextId++), entityType: 'feed', feedType: operation === 'questionCreate' ? 'question' : 'vote' } } };
      },
    };
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/.local/creation-harness.html');
  const navigate = async value => { await page.evaluate(value => window.__creationNavigate(value), value); await page.getByRole('dialog').waitFor(); };
  const pollOptions = async () => { for (const index of [4, 3]) if (await page.getByRole('button', { name: '删除选项 ' + index, exact: true }).count()) await page.getByRole('button', { name: '删除选项 ' + index, exact: true }).click(); await page.getByRole('textbox', { name: '投票选项 1', exact: true }).fill('模拟甲'); await page.getByRole('textbox', { name: '投票选项 2', exact: true }).fill('模拟乙'); };
  const writes = () => page.evaluate(() => window.__creationMock.calls.filter(call => ['questionCreate', 'pollCreate'].includes(call.operation)));
  await record('guest editor requires login and issues no creation requests', async () => {
    await navigate({ loggedIn: false, namespace: 'guest' }); await page.getByRole('button', { name: '登录酷安', exact: true }).click(); assert.equal(await page.evaluate(() => window.__creationLogin), true); assert.equal((await writes()).length, 0);
  });
  await record('invalid options block writes; ordinary choice poll sends exact reviewed values', async () => {
    await navigate({ loggedIn: true, namespace: 'synthetic-A', kind: 'poll' }); await page.getByRole('textbox', { name: '投票标题', exact: true }).fill('模拟选项投票');
    await page.getByRole('button', { name: '发布投票', exact: true }).click(); await page.getByText('请填写每个投票选项', { exact: true }).waitFor(); assert.equal((await writes()).length, 0);
    await page.getByRole('button', { name: '返回修改内容', exact: true }).click(); await pollOptions(); await page.getByRole('combobox', { name: '投票上限', exact: true }).selectOption('2'); await page.getByRole('combobox', { name: '投票截止时间', exact: true }).selectOption('86400');
    await page.getByRole('button', { name: '发布投票', exact: true }).click(); await page.getByText('窗口已关闭', { exact: true }).waitFor();
    const [{ operation, args }] = await writes(); assert.equal(operation, 'pollCreate'); assert.equal(args.title, '模拟选项投票'); assert.deepEqual(args.options, ['模拟甲', '模拟乙']); assert.equal(args.maxSelectNum, 2); assert.equal(args.endTime, 86400); assert.equal(args.pollType, 1); assert.equal(args.pic, undefined);
  });
  await record('PK editor enforces two UTF16-limited viewpoints and optional colors', async () => {
    await navigate({ kind: 'poll', namespace: 'synthetic-A' }); await page.getByRole('textbox', { name: '投票标题', exact: true }).fill('模拟PK'); await page.getByRole('combobox', { name: '投票类型', exact: true }).selectOption('0');
    await page.getByRole('textbox', { name: '正方观点', exact: true }).fill('模拟正方'); await page.getByRole('textbox', { name: '反方观点', exact: true }).fill('模拟反方');
    assert.equal(await page.getByRole('textbox', { name: '正方观点', exact: true }).getAttribute('maxlength'), '10'); assert.equal(await page.getByRole('button', { name: /添加选项/ }).count(), 0); assert.equal(await page.getByRole('combobox', { name: '投票上限', exact: true }).count(), 0); assert.equal(await page.getByLabel('添加图片附件', { exact: true }).count(), 0);
    await page.getByLabel('正方颜色', { exact: true }).fill('#ff0000'); await page.getByRole('button', { name: '发布投票', exact: true }).click(); await page.getByText('窗口已关闭', { exact: true }).waitFor();
    const item = (await writes()).at(-1); assert.equal(item.args.pollType, 0); assert.equal(item.args.maxSelectNum, 1); assert.equal(item.args.options.length, 2); assert.equal(item.args.colors[0], '#FF0000');
  });
  await record('question editor opens related reads and normalizes title before its explicit create', async () => {
    await navigate({ kind: 'question', namespace: 'synthetic-A' }); await page.getByRole('textbox', { name: '问题标题', exact: true }).fill('模拟问题'); await page.getByRole('textbox', { name: '问题补充', exact: true }).fill('模拟问题背景');
    await page.getByRole('button', { name: '模拟相似问题？', exact: true }).waitFor(); await page.getByRole('button', { name: '模拟相似问题？', exact: true }).click(); assert.equal(await page.evaluate(() => window.__creationQuestion), '401');
    const before = (await writes()).length; await page.getByRole('button', { name: '发布问题', exact: true }).click(); await page.getByText('窗口已关闭', { exact: true }).waitFor();
    const after = await writes(); assert.equal(after.length, before + 1); assert.equal(after.at(-1).operation, 'questionCreate'); assert.equal(after.at(-1).args.title, '模拟问题？'); assert.equal(after.at(-1).args.message, '模拟问题背景');
  });
  await record('verification keeps the reviewed request immutable and replays that exact request', async () => {
    await navigate({ kind: 'poll', namespace: 'synthetic-A' }); await pollOptions(); await page.getByRole('textbox', { name: '投票标题', exact: true }).fill('模拟验证投票'); await page.evaluate(() => { window.__creationMock.failure = 'verify'; });
    await page.getByRole('button', { name: '发布投票', exact: true }).click(); await page.getByText('模拟发布验证码', { exact: true }).waitFor(); assert.equal(await page.getByRole('textbox', { name: '投票标题', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.getByText('窗口已关闭', { exact: true }).waitFor(); const calls = (await writes()).filter(item => item.args.title === '模拟验证投票'); assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
  });
  await record('switching account invalidates a pending verification without issuing a new-account replay', async () => {
    await navigate({ kind: 'poll', namespace: 'synthetic-A' }); await pollOptions(); await page.getByRole('textbox', { name: '投票标题', exact: true }).fill('模拟旧账号验证'); await page.evaluate(() => { window.__creationMock.failure = 'verify'; window.__creationMock.verifyHeld = true; });
    await page.getByRole('button', { name: '发布投票', exact: true }).click(); await page.getByText('模拟发布验证码', { exact: true }).waitFor(); await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => !!window.__creationMock.releaseVerify);
    await navigate({ namespace: 'synthetic-B' }); await page.evaluate(() => { window.__creationMock.verifyHeld = false; window.__creationMock.releaseVerify(); }); await page.waitForTimeout(120);
    assert.equal((await writes()).filter(item => item.args.title === '模拟旧账号验证').length, 1); assert.equal(await page.getByRole('textbox', { name: '投票标题', exact: true }).inputValue(), '');
  });
  await record('unconfirmed creation never auto-retries and needs an explicit latest-content check', async () => {
    await pollOptions(); await page.getByRole('textbox', { name: '投票标题', exact: true }).fill('模拟结果未确认'); await page.evaluate(() => { window.__creationMock.failure = 'uncertain'; });
    await page.getByRole('button', { name: '发布投票', exact: true }).click(); await page.getByText('模拟提交结果未确认', { exact: true }).waitFor(); await page.waitForTimeout(100);
    const retry = page.getByRole('button', { name: '重试原发布请求', exact: true }); assert.equal(await retry.isDisabled(), true); assert.equal((await writes()).filter(item => item.args.title === '模拟结果未确认').length, 1);
    await page.getByRole('checkbox', { name: /我已检查最新动态/ }).check(); await retry.click(); await page.getByText('窗口已关闭', { exact: true }).waitFor(); const calls = (await writes()).filter(item => item.args.title === '模拟结果未确认'); assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
  });
  await record('local text drafts are account-scoped and require no publication', async () => {
    const before = (await writes()).length; await navigate({ kind: 'question', namespace: 'synthetic-A' }); await page.getByRole('textbox', { name: '问题标题', exact: true }).fill('模拟本地草稿'); await page.getByRole('textbox', { name: '问题补充', exact: true }).fill('模拟草稿正文'); await page.getByRole('button', { name: '保存文字草稿', exact: true }).click();
    await navigate({ namespace: 'synthetic-B' }); assert.equal(await page.getByRole('button', { name: '载入草稿', exact: true }).count(), 0);
    await navigate({ namespace: 'synthetic-A' }); await page.getByRole('button', { name: '载入草稿', exact: true }).click(); assert.equal(await page.getByRole('textbox', { name: '问题标题', exact: true }).inputValue(), '模拟本地草稿'); assert.equal(await page.getByRole('textbox', { name: '问题补充', exact: true }).inputValue(), '模拟草稿正文'); assert.equal((await writes()).length, before);
  });
  await record('closing during image upload suppresses the later create rather than moving it to another account', async () => {
    const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4; const ctx = canvas.getContext('2d'); ctx.fillStyle = 'green'; ctx.fillRect(0, 0, 4, 4); return canvas.toDataURL('image/png').split(',')[1]; });
    await page.getByLabel('添加图片附件', { exact: true }).setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }); await page.evaluate(() => { window.__creationMock.hold = 'uploadImage'; window.__creationMock.release = null; }); const before = (await writes()).length;
    await page.getByRole('button', { name: '发布问题', exact: true }).click(); await page.waitForFunction(() => !!window.__creationMock.release); await page.getByRole('button', { name: '关闭', exact: true }).first().click(); await page.getByText('窗口已关闭', { exact: true }).waitFor();
    await navigate({ namespace: 'synthetic-B' }); await page.evaluate(() => { window.__creationMock.hold = ''; window.__creationMock.release(); }); await page.waitForTimeout(120); assert.equal((await writes()).length, before);
  });
  await record('native editor controls fit narrow windows and remain keyboard reachable in dark mode', async () => {
    await navigate({ kind: 'poll', namespace: 'synthetic-C' }); await page.setViewportSize({ width: 720, height: 900 }); await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await page.getByRole('textbox', { name: '投票标题', exact: true }).fill('模拟深色布局');
    await page.getByRole('button', { name: '发布板块、可见范围与内容声明', exact: true }).click(); await page.getByRole('combobox', { name: '可见范围', exact: true }).focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '内容声明');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: '.local/creation-check/narrow-dark.png' });
    await page.keyboard.press('Escape'); await page.getByText('窗口已关闭', { exact: true }).waitFor();
  });
  assert.deepEqual(errors, []);
  writeFileSync('research/creation-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'synthetic renderer UI and request construction; all outside requests blocked; no real accounts, posts, votes, reports or deletions', checks, errors }, null, 2) + '\n');
  await context.close();
} catch (error) { const page = browser?.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: '.local/creation-check/failure.png' }); console.log('FAILURE_STATE', await page.locator('body').innerText()); } throw error; }
finally { await browser?.close(); await server.close(); }
