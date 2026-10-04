// Isolated renderer checks. RPC replies and writes are synthetic; external network is blocked.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const directory = resolve('.local/account-relations-check'), port = Number(process.env.COOLAPK_ACCOUNT_RELATIONS_PORT || 5242), origin = `http://127.0.0.1:${port}`;
const component = process.env.COOLAPK_ACCOUNT_RELATIONS_SOURCE || '/src/AccountCenter.tsx';
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, 'test.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>');
writeFileSync(resolve(directory, 'entry.tsx'), `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AccountCenter}from${JSON.stringify(component)};import'/src/styles.css';
function Fixture(){const[spec,setSpec]=useState({namespace:'account-a',guest:false,shown:true,revision:0,section:'relations'});window.__accountSpec=patch=>setSpec(old=>({...old,...patch}));window.__accountMock.namespace=spec.namespace;const account={uid:spec.namespace==='account-a'?'100':'200',username:'模拟账号',userAvatar:''};return <main style={{maxWidth:1000,padding:20}}>{spec.shown&&<AccountCenter account={spec.guest?null:account} namespace={spec.namespace} section={spec.section} revision={spec.revision} onLogin={()=>window.__accountMock.logins++} onOpenEntity={entity=>window.__accountMock.opened.push(entity.uid)} onLink={()=>{}} toast={message=>window.__accountMock.toasts.push(message)} onUpdated={()=>window.__accountMock.updated++}/>}</main>};createRoot(document.getElementById('root')).render(<Fixture/>);`);
const server = await createServer({ logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true } }); await server.listen();
let browser, context; const checks = [], errors = [], selected = process.env.COOLAPK_ACCOUNT_RELATIONS_CASE;
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const calls = page => page.evaluate(() => window.__accountMock.calls);
const writes = async page => (await calls(page)).filter(row => row.operation === 'accountRelationship');
const row = (page, name) => page.locator('.ac-user').filter({ has: page.locator('.ac-user-main strong').getByText(name, { exact: true }) });
async function record(id, name, run) {
  if (selected && selected !== id) return;
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  try { await page.goto(`${origin}/.local/account-relations-check/test.html`); await row(page, '关注好友').waitFor(); await run(page); checks.push(name); console.log('PASS', name); }
  catch (error) { await page.screenshot({ path: resolve(directory, `${id}-failure.png`) }); console.log('FAILURE_STATE', await page.locator('body').innerText()); throw error; }
  finally { await page.close(); }
}
async function openManage(page, name) { await page.getByRole('button', { name: '管理关系 ' + name, exact: true }).click(); return page.getByRole('dialog', { name: '管理酷友关系', exact: true }); }
async function fans(page) { await page.getByRole('tab', { name: '粉丝', exact: true }).click(); await row(page, '待回关粉丝').waitFor(); }
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  context = await browser.newContext({ viewport: { width: 1120, height: 900 } });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const scope = () => ({ following: { '301': true, '303': true }, special: {}, black: {}, ignore: {}, remarks: {}, profile: { bio: '原资料签名', gender: 1, birthyear: 2000, birthmonth: 1, birthday: 1, province: '广东', city: '深圳' } });
    const mock = window.__accountMock = { namespace: 'account-a', calls: [], errors: {}, verifies: [], holds: {}, pending: [], states: { 'account-a': scope(), 'account-b': scope() }, toasts: [], updated: 0, logins: 0, opened: [], paging: false, selfRow: false };
    const user = (uid, state) => ({ id: 'relation-' + uid, entityType: 'user', uid, username: { '100': '当前账号自己', '301': '关注好友', '302': '待回关粉丝', '303': '互关粉丝', '304': '受限酷友', '305': '分页粉丝', '501': '新账号好友' }[uid] || 'UID备注酷友', userAvatar: '', isFollow: state.following[uid] ? 1 : 0, isSpecialFollow: state.special[uid] ? 1 : 0, remarkName: state.remarks[uid] || '' });
    window.coolapk = { call: async (operation, args = {}) => {
      const namespace = mock.namespace, state = mock.states[namespace], page = args.page || 1;
      mock.calls.push({ operation, args: structuredClone(args), namespace });
      const key = operation === 'accountUsers' ? `${namespace}:${args.type}:${page}` : operation === 'accountProfile' ? `${namespace}:profile:1` : `${namespace}:${args.action}:${args.uid}`;
      if (mock.holds[key]) await new Promise(resolve => mock.pending.push({ key, resolve }));
      if (mock.errors[key]) return { ok: false, error: { code: mock.errors[key], message: '模拟失败 ' + key, ...(mock.errors[key] === 'VERIFY_REQUIRED' ? { verificationId: key } : {}) } };
      if (operation === 'accountProfile') return { ok: true, data: { data: { ...state.profile } } };
      if (operation === 'accountProfileUpdate') { if (args.field === 'gender') state.profile.gender = Number(args.value); else if (args.field === 'bio') state.profile.bio = args.value; else throw new Error('Unexpected synthetic profile field'); return { ok: true, data: { data: 1 } }; }
      if (operation === 'accountUsers') {
        let ids;
        if (args.type === 'follow') ids = namespace === 'account-b' ? ['501'] : Object.keys(state.following).filter(uid => uid !== '303');
        else if (args.type === 'fans') ids = mock.paging ? page === 1 ? ['302'] : page === 2 ? ['305'] : [] : ['302', '303'];
        else if (args.type === 'limit') ids = ['304'];
        else if (args.type === 'remarks') ids = Object.keys(state.remarks).filter(uid => state.remarks[uid]);
        else ids = Object.keys(state[args.type]).filter(uid => state[args.type][uid]);
        if (mock.selfRow && args.type === 'black') ids.push('100');
        return { ok: true, data: { data: ids.map(uid => user(uid, state)), firstItem: args.type + '-first', lastItem: args.type + '-page-' + page, hasMore: mock.paging && args.type === 'fans' && page === 1 } };
      }
      if (operation === 'accountRelationship') {
        if (args.action === 'follow') state.following[args.uid] = true;
        else if (args.action === 'unfollow') delete state.following[args.uid];
        else if (args.action === 'special') state.special[args.uid] = args.value;
        else if (args.action === 'black') state.black[args.uid] = true;
        else if (args.action === 'unblack') delete state.black[args.uid];
        else if (args.action === 'ignore') state.ignore[args.uid] = true;
        else if (args.action === 'unignore') delete state.ignore[args.uid];
        else if (args.action === 'remark') state.remarks[args.uid] = args.name;
        else if (args.action !== 'cancelFan') throw new Error('Unexpected synthetic relationship action: ' + args.action);
        return { ok: true, data: { data: 1 } };
      }
      throw new Error('Unexpected synthetic RPC: ' + operation);
    }, verify: id => new Promise(resolve => mock.verifies.push({ id, resolve: () => resolve({ ok: true, data: {} }) })) };
  });
  await record('followback', 'fans can follow back the exact UID and show only the server-confirmed followed state', async page => {
    await fans(page); assert.equal(await row(page, '互关粉丝').getByRole('button', { name: '已关注', exact: true }).isDisabled(), true);
    await row(page, '待回关粉丝').getByRole('button', { name: '回关', exact: true }).click();
    await row(page, '待回关粉丝').getByRole('button', { name: '已关注', exact: true }).waitFor();
    assert.deepEqual((await writes(page)).map(value => value.args), [{ action: 'follow', uid: '302' }]);
    const dialog = await openManage(page, '待回关粉丝'); await dialog.getByRole('button', { name: '取消关注', exact: true }).click();
    await row(page, '待回关粉丝').getByRole('button', { name: '回关', exact: true }).waitFor();
    assert.deepEqual((await writes(page)).at(-1).args, { action: 'unfollow', uid: '302' });
  });
  await record('row-actions', 'row management adds and removes blacklists and feed ignores without confusing relation IDs with user UIDs', async page => {
    await fans(page); let dialog = await openManage(page, '待回关粉丝'); await dialog.getByRole('button', { name: '加入黑名单', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('tab', { name: '黑名单', exact: true }).click(); await row(page, '待回关粉丝').waitFor(); await row(page, '待回关粉丝').getByRole('button', { name: '移出黑名单', exact: true }).click(); await row(page, '待回关粉丝').waitFor({ state: 'hidden' });
    await fans(page); dialog = await openManage(page, '待回关粉丝'); await dialog.getByRole('button', { name: '屏蔽动态', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('tab', { name: '屏蔽', exact: true }).click(); await row(page, '待回关粉丝').waitFor(); dialog = await openManage(page, '待回关粉丝'); await dialog.getByRole('button', { name: '取消屏蔽', exact: true }).click(); await row(page, '待回关粉丝').waitFor({ state: 'hidden' });
    assert.deepEqual((await writes(page)).map(value => value.args), ['black', 'unblack', 'ignore', 'unignore'].map(action => ({ action, uid: '302' })));
  });
  await record('special', 'row management toggles special follow with exact boolean values and keeps user profile navigation intact', async page => {
    await row(page, '关注好友').locator('.ac-user-main').click(); assert.deepEqual(await page.evaluate(() => window.__accountMock.opened), ['301']);
    let dialog = await openManage(page, '关注好友'); await dialog.getByRole('button', { name: '特别关注', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); await row(page, '关注好友').getByRole('button', { name: '取消特别关注', exact: true }).waitFor();
    dialog = await openManage(page, '关注好友'); await dialog.getByRole('button', { name: '取消特别关注', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); await row(page, '关注好友').getByRole('button', { name: '特别关注', exact: true }).waitFor();
    assert.deepEqual((await writes(page)).map(value => value.args), [{ action: 'special', uid: '301', value: true }, { action: 'special', uid: '301', value: false }]);
  });
  await record('remark', 'a UID outside the loaded list can be given a remark and its explicit clear action sends an empty name', async page => {
    await page.getByLabel('酷友 UID', { exact: true }).fill('909'); await page.getByLabel('关系操作', { exact: true }).selectOption('remark'); await page.getByRole('button', { name: '确认', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '修改备注', exact: true }); await dialog.getByLabel('备注名称，最多 30 字', { exact: true }).fill('新备注'); await dialog.getByRole('button', { name: '保存备注', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('tab', { name: '备注', exact: true }).click(); await row(page, '新备注').waitFor(); const manage = await openManage(page, 'UID备注酷友'); await manage.getByRole('button', { name: '清除备注', exact: true }).click(); await row(page, '新备注').waitFor({ state: 'hidden' });
    assert.deepEqual((await writes(page)).map(value => value.args), [{ action: 'remark', uid: '909', name: '新备注' }, { action: 'remark', uid: '909', name: '' }]);
  });
  await record('verification', 'remark verification freezes the submitted UID and text, then replays exactly once', async page => {
    await page.evaluate(() => { window.__accountMock.errors['account-a:remark:909'] = 'VERIFY_REQUIRED'; });
    await page.getByLabel('酷友 UID', { exact: true }).fill('909'); await page.getByLabel('关系操作', { exact: true }).selectOption('remark'); await page.getByRole('button', { name: '确认', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '修改备注', exact: true }); const input = dialog.getByLabel('备注名称，最多 30 字', { exact: true }); await input.fill('验证原备注'); await dialog.getByRole('button', { name: '保存备注', exact: true }).click(); await dialog.getByRole('button', { name: '完成验证', exact: true }).waitFor(); assert.equal(await input.isDisabled(), true);
    await dialog.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => window.__accountMock.verifies.length === 1);
    await page.evaluate(() => { delete window.__accountMock.errors['account-a:remark:909']; window.__accountMock.verifies[0].resolve(); }); await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual((await writes(page)).map(value => value.args), [{ action: 'remark', uid: '909', name: '验证原备注' }, { action: 'remark', uid: '909', name: '验证原备注' }]);
  });
  await record('action-retry', 'failed followback remains actionable and retry preserves the original UID', async page => {
    await fans(page); await page.evaluate(() => { window.__accountMock.errors['account-a:follow:302'] = 'NETWORK'; }); await row(page, '待回关粉丝').getByRole('button', { name: '回关', exact: true }).click(); await page.getByText('模拟失败 account-a:follow:302', { exact: true }).waitFor();
    assert.equal(await row(page, '待回关粉丝').getByRole('button', { name: '回关', exact: true }).count(), 1); await page.evaluate(() => { delete window.__accountMock.errors['account-a:follow:302']; }); await page.getByRole('button', { name: '重试', exact: true }).click(); await row(page, '待回关粉丝').getByRole('button', { name: '已关注', exact: true }).waitFor();
    assert.deepEqual((await writes(page)).map(value => value.args), [{ action: 'follow', uid: '302' }, { action: 'follow', uid: '302' }]);
  });
  await record('scope-verification', 'category changes, account changes and unmounts cancel delayed relationship verification replays', async page => {
    for (const change of ['category', 'account', 'unmount']) {
      await page.evaluate(() => { window.__accountSpec({ namespace: 'account-a', shown: true }); window.__accountMock.errors['account-a:follow:302'] = 'VERIFY_REQUIRED'; window.__accountMock.states['account-a'].following['302'] = false; }); await settle(page); await fans(page); await row(page, '待回关粉丝').getByRole('button', { name: '回关', exact: true }).click(); await page.getByRole('button', { name: '完成验证', exact: true }).click();
      await page.waitForFunction(() => window.__accountMock.verifies.length > 0);
      if (change === 'category') { await page.getByRole('tab', { name: '备注', exact: true }).click(); await page.getByText('列表为空', { exact: true }).waitFor(); }
      else if (change === 'account') { await page.evaluate(() => window.__accountSpec({ namespace: 'account-b' })); await row(page, '新账号好友').waitFor(); }
      else { await page.evaluate(() => window.__accountSpec({ shown: false })); await page.locator('.account-center').waitFor({ state: 'hidden' }); }
      const before = (await writes(page)).length; await page.evaluate(() => { window.__accountMock.errors = {}; window.__accountMock.verifies.splice(0).forEach(item => item.resolve()); }); await settle(page); assert.equal((await writes(page)).length, before);
    }
  });
  await record('scope-response', 'a delayed write response from the previous account does not toast, refresh or replace the new account list', async page => {
    await fans(page); await page.evaluate(() => { window.__accountMock.holds['account-a:follow:302'] = true; }); await row(page, '待回关粉丝').getByRole('button', { name: '回关', exact: true }).click(); await page.waitForFunction(() => window.__accountMock.pending.length === 1);
    await page.evaluate(() => window.__accountSpec({ namespace: 'account-b' })); await row(page, '新账号好友').waitFor(); const before = (await calls(page)).length;
    await page.evaluate(() => window.__accountMock.pending.splice(0).forEach(item => item.resolve())); await settle(page);
    assert.equal((await calls(page)).length, before); assert.equal(await row(page, '新账号好友').count(), 1); assert.deepEqual(await page.evaluate(() => ({ toasts: window.__accountMock.toasts, updated: window.__accountMock.updated })), { toasts: [], updated: 0 });
  });
  await record('permissions', 'guest, self UID and restricted-list permissions never expose actionable relationship writes', async page => {
    await page.getByLabel('酷友 UID', { exact: true }).fill('100'); assert.equal(await page.getByRole('button', { name: '确认', exact: true }).isDisabled(), true);
    await page.evaluate(() => { window.__accountMock.selfRow = true; }); await page.getByRole('tab', { name: '黑名单', exact: true }).click(); await row(page, '当前账号自己').waitFor(); assert.equal(await row(page, '当前账号自己').getByRole('button', { name: '管理关系 当前账号自己', exact: true }).isDisabled(), true); assert.equal(await row(page, '当前账号自己').getByRole('button', { name: '移出黑名单', exact: true }).isDisabled(), true);
    await page.getByRole('tab', { name: '受限列表', exact: true }).click(); await row(page, '受限酷友').waitFor(); assert.equal(await row(page, '受限酷友').locator('.ac-user-actions').count(), 0); assert.equal(await page.getByLabel('酷友 UID', { exact: true }).count(), 0);
    const before = (await calls(page)).length; await page.evaluate(() => window.__accountSpec({ guest: true })); await page.getByRole('button', { name: '登录酷安', exact: true }).waitFor(); assert.equal(await page.getByRole('tab', { name: '粉丝', exact: true }).count(), 0); assert.equal((await calls(page)).length, before); assert.deepEqual(await writes(page), []);
  });
  await record('paging', 'network and verification retries preserve existing fans and repeat exact second-page cursors', async page => {
    for (const code of ['NETWORK', 'VERIFY_REQUIRED']) {
      await page.evaluate(code => { window.__accountMock.paging = true; window.__accountMock.errors['account-a:fans:2'] = code; }, code); await fans(page); const start = (await calls(page)).length; await page.getByRole('button', { name: '加载更多', exact: true }).click(); await page.getByText('模拟失败 account-a:fans:2', { exact: true }).waitFor(); assert.equal(await row(page, '待回关粉丝').count(), 1);
      await page.evaluate(() => { delete window.__accountMock.errors['account-a:fans:2']; });
      if (code === 'NETWORK') await page.getByRole('button', { name: '重试', exact: true }).click();
      else { await page.getByRole('button', { name: '完成验证', exact: true }).click(); await page.waitForFunction(() => window.__accountMock.verifies.length === 1); await page.evaluate(() => window.__accountMock.verifies.splice(0).forEach(item => item.resolve())); }
      await row(page, '分页粉丝').waitFor(); const requests = (await calls(page)).slice(start); assert.deepEqual(requests.map(value => value.args.page), [2, 2]); assert.deepEqual(requests[0].args, { type: 'fans', page: 2, firstItem: 'fans-first', lastItem: 'fans-page-1' }); assert.deepEqual(requests[1].args, requests[0].args); assert.equal(await row(page, '待回关粉丝').count(), 1);
      await page.getByRole('tab', { name: '关注', exact: true }).click(); await row(page, '关注好友').waitFor();
    }
  });
  await record('read-error', 'initial read failures show an error and retry page one instead of presenting an empty successful list', async page => {
    await page.evaluate(() => { window.__accountMock.errors['account-a:remarks:1'] = 'NETWORK'; }); await page.getByRole('tab', { name: '备注', exact: true }).click(); await page.getByText('模拟失败 account-a:remarks:1', { exact: true }).waitFor(); assert.equal(await page.getByText('列表为空', { exact: true }).count(), 0);
    await page.evaluate(() => { delete window.__accountMock.errors['account-a:remarks:1']; }); await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByText('列表为空', { exact: true }).waitFor();
    assert.deepEqual((await calls(page)).filter(value => value.args.type === 'remarks').map(value => value.args.page || 1), [1, 1]);
  });
  await record('profile-drafts', 'profile field drafts survive late reads and saving another field, then reset on account switch', async page => {
    await page.evaluate(() => window.__accountSpec({ section: 'profile' })); const bio = page.getByLabel('个性签名', { exact: true }); await page.waitForFunction(() => document.querySelector('#ac-bio')?.value === '原资料签名'); await bio.fill('未保存的资料草稿');
    await page.evaluate(() => { window.__accountMock.holds['account-a:profile:1'] = true; window.__accountSpec({ revision: 1 }); }); await page.waitForFunction(() => window.__accountMock.pending.length === 1);
    await page.evaluate(() => { window.__accountMock.states['account-a'].profile.gender = 0; window.__accountMock.holds = {}; window.__accountMock.pending.splice(0).forEach(item => item.resolve()); }); await page.waitForFunction(() => document.querySelector('#ac-gender')?.value === '0'); assert.equal(await bio.inputValue(), '未保存的资料草稿');
    const gender = page.getByLabel('性别', { exact: true }); await gender.selectOption('1'); await page.locator('form').filter({ has: gender }).getByRole('button', { name: '保存', exact: true }).click(); await page.waitForFunction(() => window.__accountMock.calls.filter(value => value.operation === 'accountProfile').length === 3 && !document.querySelector('.ac-status')); assert.equal(await bio.inputValue(), '未保存的资料草稿');
    assert.deepEqual((await calls(page)).filter(value => value.operation === 'accountProfileUpdate').map(value => value.args), [{ field: 'gender', value: '1' }]);
    await page.evaluate(() => { window.__accountMock.states['account-b'].profile.bio = '新账号签名'; window.__accountSpec({ namespace: 'account-b' }); }); await page.waitForFunction(() => document.querySelector('#ac-bio')?.value === '新账号签名'); assert.equal(await bio.inputValue(), '新账号签名');
  });
  assert.deepEqual(errors, []); assert.ok(checks.length, 'No matching account relations checks');
  if (!selected) writeFileSync('research/account-relations-checks.json', JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'isolated synthetic account renderer; external network blocked; no real account writes', checks, errors }, null, 2));
} finally { await context?.close(); await browser?.close(); await server.close(); }
