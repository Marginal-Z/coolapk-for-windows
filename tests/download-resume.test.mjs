import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApkDownloadUrl, openApkDownload } from '../core/download.mjs';
const { DownloadManager } = createRequire(import.meta.url)('../electron/download-manager.cjs');
const bytes = Uint8Array.from([80,75,3,4,10,20,30,40]), pn = 'com.example.synthetic', etag = '"fixture-version-30"';
const resourceUrl = 'https://download.coolapk.com/synthetic.apk', resourceSha256 = createHash('sha256').update(resourceUrl).digest('hex');
const plan = { packageName: pn, apkId: '7', versionCode: '30', title: '模拟安装包', requestUrl: buildApkDownloadUrl(pn, '7', '30') };
const headers = { 'content-type': 'application/vnd.android.package-archive', 'content-length': '8', etag };
const opened = response => ({ response, plan, resourceSha256, rangeOffset: response.status === 206 ? 4 : 0, verified: true, assertCurrent: () => {} });
async function until(check) { const deadline = Date.now() + 4000; while (!check()) { if (Date.now() > deadline) throw new Error('Synthetic resume check timed out'); await new Promise(resolve => setTimeout(resolve, 10)); } }
async function fixture(work, initialHeaders = headers) {
  const directory = await mkdtemp(path.join(tmpdir(), 'coolapk-resume-test-')), calls = [];
  let manager, controller;
  try {
    manager = new DownloadManager({ directory, openDownload: async (args, options) => {
      calls.push(options.resume);
      if (calls.length === 1) return opened(new Response(new ReadableStream({ start(value) { controller = value; value.enqueue(bytes.slice(0,4)); } }), { headers: initialHeaders }));
      return opened(new Response(bytes.slice(4), { status: 206, headers: { ...headers, 'content-length':'4', 'content-range':'bytes 4-7/8' } }));
    } });
    const task = manager.add({ packageName: pn }); await until(() => manager.task(task.id).downloaded === 4);
    manager.pause(task.id); await until(() => manager.running.size === 0);
    await work(manager, task.id, directory, calls, controller);
  } finally { manager?.close(); if (manager) await until(() => manager.running.size === 0 && [...manager.tasks.values()].every(task => !task.cleanup)); await rm(directory, { recursive: true }); }
}

// Hold a real asynchronous file boundary, rather than relying on a timer to hit
// the short window between pause/cancel and the downloader's next state change.
async function gatedManager(boundary, work) {
  const directory = await mkdtemp(path.join(tmpdir(), 'coolapk-resume-gate-'));
  let manager, entered = false, released = false;
  let release;
  const gate = new Promise(resolve => { release = () => { released = true; resolve(); }; });
  try {
    manager = new DownloadManager({ directory, openDownload: async () => opened(new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 4)); } }), { headers })) });
    const originalPathFor = manager.pathFor.bind(manager);
    manager.pathFor = async (task, partial = false) => {
      const file = await originalPathFor(task, partial);
      const matches = boundary === 'before-status' ? !partial && task.status === 'resolving' : partial && task.status === 'paused';
      if (!entered && matches) { entered = true; await gate; }
      return file;
    };
    const task = manager.add({ packageName: pn });
    if (boundary === 'paused-digest') { await until(() => manager.task(task.id).downloaded === 4); manager.pause(task.id); }
    await until(() => entered);
    await work(manager, task.id, directory, release);
  } finally {
    // A failed assertion or timeout must release the intercepted operation so
    // close/cleanup can finish and the test runner has no pending stream.
    if (!released) release();
    manager?.close();
    if (manager) await until(() => manager.running.size === 0 && [...manager.tasks.values()].every(task => !task.cleanup));
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('coolapk-resume-gate-'));
    await rm(directory, { recursive: true });
  }
}

async function assertNoPartialOrApk(manager, id, directory) {
  await until(() => manager.running.size === 0 && !manager.task(id).cleanup);
  assert.equal(manager.task(id).resumeInfo, undefined);
  assert.equal(manager.task(id).downloaded, 0);
  assert.equal((await readdir(directory)).filter(name => /\.apk(?:\.part)?$/.test(name)).length, 0);
}

test('pause during file preparation stays paused and cannot be overwritten by downloading', async () => {
  await gatedManager('before-status', async (manager, id, directory, release) => {
    manager.pause(id);
    release();
    await assertNoPartialOrApk(manager, id, directory);
    const snapshot = manager.snapshot(manager.task(id));
    assert.equal(snapshot.status, 'paused'); assert.equal(snapshot.errorCode, '');
    assert.equal(snapshot.resumable, true); assert.equal(snapshot.partialReusable, false);
  });
});

test('cancel during paused digest collection cannot revive resumable bytes or retain the partial file', async () => {
  await gatedManager('paused-digest', async (manager, id, directory, release) => {
    await manager.cancel(id);
    release();
    await assertNoPartialOrApk(manager, id, directory);
    const snapshot = manager.snapshot(manager.task(id));
    assert.equal(snapshot.status, 'canceled'); assert.equal(snapshot.errorCode, '');
    assert.equal(snapshot.resumable, false); assert.equal(snapshot.partialReusable, false);
  });
});

test('account invalidation during paused digest collection cannot restore old account continuation', async () => {
  await gatedManager('paused-digest', async (manager, id, directory, release) => {
    manager.invalidateScope();
    release();
    await assertNoPartialOrApk(manager, id, directory);
    const snapshot = manager.snapshot(manager.task(id));
    assert.equal(snapshot.status, 'failed'); assert.equal(snapshot.errorCode, 'ACCOUNT_CHANGED');
    assert.equal(snapshot.resumable, false); assert.equal(snapshot.partialReusable, false);
    assert.throws(() => manager.resume(id), /不能|尚未/);
  });
});

test('pause preserves checked bytes and strong ETag; verified 206 appends and hashes the complete APK', async () => {
  await fixture(async (manager, id, directory, calls) => {
    const task = manager.task(id), snapshot = manager.snapshot(task);
    assert.equal(snapshot.status, 'paused'); assert.equal(snapshot.resumable, true); assert.equal(snapshot.partialReusable, true); assert.equal(snapshot.verified, false);
    assert.deepEqual(new Uint8Array(await readFile(path.join(directory, task.fileName + '.part'))), bytes.slice(0,4));
    await assert.rejects(manager.completedFile(id), /尚未完成校验/);
    manager.resume(id); await until(() => manager.task(id).status === 'completed' && manager.running.size === 0);
    assert.deepEqual(calls[1], { offset:4,total:8,etag,versionCode:'30',resourceSha256 });
    assert.deepEqual(new Uint8Array(await readFile((await manager.completedFile(id)).path)), bytes);
    assert.equal(manager.task(id).sha256, createHash('sha256').update(bytes).digest('hex'));
  });
});

test('ignored ranges safely restart from zero; weak validators never request a byte continuation', async () => {
  await fixture(async (manager, id, directory) => {
    manager.openDownload = async (args, options) => { assert.equal(options.resume.offset,4); return opened(new Response(bytes,{headers})); };
    manager.resume(id); await until(() => manager.task(id).status === 'completed'); assert.deepEqual(new Uint8Array(await readFile((await manager.completedFile(id)).path)),bytes);
  });
  await fixture(async (manager,id,directory) => {
    assert.equal(manager.task(id).resumeInfo, undefined); assert.equal(manager.task(id).downloaded, 0); assert.equal((await readdir(directory)).some(name=>name.endsWith('.part')),false);
    manager.openDownload = async (args,options) => { assert.equal(options.resume,undefined); return opened(new Response(bytes,{headers})); };
    manager.resume(id); await until(() => manager.task(id).status === 'completed'); assert.deepEqual(new Uint8Array(await readFile((await manager.completedFile(id)).path)),bytes);
  }, {...headers,etag:'W/"fixture"'});
});

test('wrong offset, total, validator and updated version cannot publish mixed APKs', async () => {
  const variants = [
    () => opened(new Response(bytes.slice(4),{status:206,headers:{...headers,'content-length':'4','content-range':'bytes 3-6/7'}})),
    () => opened(new Response(bytes.slice(4),{status:206,headers:{...headers,'content-length':'4','content-range':'bytes 4-7/9'}})),
    () => opened(new Response(bytes.slice(4),{status:206,headers:{...headers,etag:'"changed"','content-length':'4','content-range':'bytes 4-7/8'}})),
    () => ({...opened(new Response(bytes,{headers})),plan:{...plan,versionCode:'31'}}),
  ];
  for (const response of variants) await fixture(async (manager,id,directory) => {
    manager.openDownload = async () => response(); manager.resume(id); await until(() => manager.task(id).status === 'failed' && manager.running.size === 0);
    assert.ok(['DOWNLOAD_TRUNCATED','DOWNLOAD_RESUME'].includes(manager.task(id).errorCode)); assert.equal((await readdir(directory)).filter(name=>/\.apk(?:\.part)?$/.test(name)).length,0);
  });
});

test('modified paused bytes fail before opening a new download; explicit restart recovers from zero', async () => {
  await fixture(async (manager,id,directory,calls) => {
    await writeFile(path.join(directory,manager.task(id).fileName+'.part'), Uint8Array.from([80,75,3,5]));
    manager.resume(id); await until(() => manager.task(id).status === 'failed' && manager.running.size === 0); assert.equal(calls.length,1); assert.equal(manager.task(id).errorCode,'DOWNLOAD_RESUME');
    manager.openDownload = async (args,options) => { assert.equal(options.resume,undefined); return opened(new Response(bytes,{headers})); };
    manager.retry(id); await until(() => manager.task(id).status==='completed'); assert.deepEqual(new Uint8Array(await readFile((await manager.completedFile(id)).path)),bytes);
  });
});

test('paused history restores without account requests and resumes only after an explicit action', async () => {
  await fixture(async (manager,id,directory) => {
    let count=0; const restored = new DownloadManager({ directory,openDownload:async(args,options)=>{count++; assert.equal(options.resume.offset,4); return opened(new Response(bytes.slice(4),{status:206,headers:{...headers,'content-length':'4','content-range':'bytes 4-7/8'}}));} });
    try { assert.equal(count,0); assert.equal(restored.task(id).status,'paused'); restored.resume(id); await until(()=>restored.task(id).status==='completed' && restored.running.size===0); assert.equal(count,1); }
    finally { restored.close(); await until(()=>restored.running.size===0); }
  });
});

test('cancel and account switching discard a settled pause; cleanup cannot race a new download', async () => {
  await fixture(async(manager,id,directory)=>{
    await manager.cancel(id); assert.equal(manager.task(id).status,'canceled'); assert.equal(manager.task(id).resumeInfo,undefined); assert.equal((await readdir(directory)).some(name=>name.endsWith('.part')),false);
  });
  await fixture(async(manager,id,directory)=>{
    manager.invalidateScope(); assert.throws(()=>manager.retry(id),/不能重试/); await until(()=>!manager.task(id).cleanup); assert.equal(manager.task(id).errorCode,'ACCOUNT_CHANGED'); assert.equal((await readdir(directory)).some(name=>name.endsWith('.part')),false); assert.throws(()=>manager.resume(id),/不能|尚未/);
  });
});

test('official resolver remains a full POST; only owned CDN GET receives Range and strong If-Range', async()=>{
  const calls=[], resume={offset:4,total:8,etag,versionCode:'30',resourceSha256};
  const client={ identity:{uid:'42'},cookie:'uid=42; token=synthetic',deviceCode:'device',request:async()=>({data:{success:true}}),fetch:async(url,options)=>{calls.push({url:String(url),options});return calls.length===1?new Response(null,{status:302,headers:{location:'https://download.coolapk.com/synthetic.apk'}}):new Response(bytes.slice(4),{status:206,headers:{...headers,'content-length':'4','content-range':'bytes 4-7/8'}});} };
  const result=await openApkDownload(client,plan,{resume}); await result.response.body.cancel();
  assert.equal(calls[0].options.method,'POST'); assert.equal(calls[0].options.headers.Range,'bytes=0-'); assert.equal(calls[0].options.headers['If-Range'],undefined);
  assert.equal(calls[1].options.method,'GET'); assert.equal(calls[1].options.headers.Range,'bytes=4-'); assert.equal(calls[1].options.headers['If-Range'],etag); assert.equal(calls[1].options.headers.Cookie,undefined);
  await assert.rejects(openApkDownload(client,plan,{resume:{...resume,etag:'W/"weak"'}}),e=>e.code==='DOWNLOAD_RESUME');
  await assert.rejects(openApkDownload(client,plan,{resume:{...resume,versionCode:'31'}}),e=>e.code==='DOWNLOAD_RESUME');
});

async function resourceFixture({ changed = true, status = 200, wrongRange = false }, work) {
  const oldBytes = bytes, newBytes = Uint8Array.from([80,75,3,4,50,60,70,80]);
  const firstUrl = 'https://download.coolapk.com/old-resource.apk';
  const nextUrl = changed ? 'https://download.coolapk.com/new-resource.apk' : firstUrl;
  const directory = await mkdtemp(path.join(tmpdir(), 'coolapk-resume-resource-'));
  const calls = []; let resolverCalls = 0, manager;
  const client = {
    identity: { uid: '0' }, cookie: '', deviceCode: 'synthetic', request: async () => ({ data: { success: true } }),
    fetch: async (url, options) => {
      const target = String(url);
      calls.push({ url: target, method: options.method, headers: { ...options.headers } });
      if (new URL(target).hostname === 'api.coolapk.com') return new Response(null, { status: 302, headers: { location: ++resolverCalls === 1 ? firstUrl : nextUrl } });
      if (resolverCalls === 1) return new Response(new ReadableStream({ start(controller) { controller.enqueue(oldBytes.slice(0, 6)); } }), { headers });
      const body = changed ? newBytes : oldBytes, offset = !changed || wrongRange ? 6 : 0;
      return new Response(status === 206 ? body.slice(offset) : body, {
        status, headers: { ...headers, 'content-length': String(status === 206 ? body.length - offset : body.length), ...(status === 206 ? { 'content-range': `bytes ${offset}-7/8` } : {}) },
      });
    },
  };
  try {
    manager = new DownloadManager({ directory, openDownload: (_args, options) => openApkDownload(client, plan, options) });
    const task = manager.add({ packageName: pn }); await until(() => manager.task(task.id).downloaded === 6);
    manager.pause(task.id); await until(() => manager.running.size === 0);
    assert.equal(manager.task(task.id).resumeInfo.resourceSha256, createHash('sha256').update(firstUrl).digest('hex'));
    const history = await readFile(path.join(directory, '.coolapk-downloads.json'), 'utf8');
    assert.equal(history.includes(firstUrl), false); assert.equal(history.includes(nextUrl), false);
    manager.resume(task.id); await until(() => manager.running.size === 0);
    await work(manager, task.id, directory, calls, changed ? newBytes : oldBytes);
  } finally {
    manager?.close(); if (manager) await until(() => manager.running.size === 0 && [...manager.tasks.values()].every(task => !task.cleanup));
    assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith('coolapk-resume-resource-'));
    await rm(directory, { recursive: true });
  }
}

test('same resource URI uses its strong validator and resumes the complete original bytes', async () => {
  await resourceFixture({ changed: false, status: 206 }, async (manager, id, directory, calls, expected) => {
    const cdnCalls = calls.filter(call => new URL(call.url).hostname === 'download.coolapk.com');
    assert.equal(cdnCalls.length, 2); assert.equal(cdnCalls[1].headers.Range, 'bytes=6-'); assert.equal(cdnCalls[1].headers['If-Range'], etag);
    assert.equal(manager.task(id).status, 'completed');
    assert.deepEqual(new Uint8Array(await readFile((await manager.completedFile(id)).path)), expected);
    assert.equal((await readdir(directory)).some(name => name.endsWith('.part')), false);
  });
});

test('different resource URI with the same ETag restarts 200 or 206 at zero without mixing files', async () => {
  for (const status of [200, 206]) await resourceFixture({ status }, async (manager, id, directory, calls, expected) => {
    const cdnCalls = calls.filter(call => new URL(call.url).hostname === 'download.coolapk.com');
    assert.equal(cdnCalls.length, 2); assert.notEqual(cdnCalls[0].url, cdnCalls[1].url);
    assert.equal(cdnCalls[1].headers.Range, 'bytes=0-'); assert.equal(cdnCalls[1].headers['If-Range'], undefined);
    assert.equal(manager.task(id).status, 'completed');
    const actual = new Uint8Array(await readFile((await manager.completedFile(id)).path));
    assert.deepEqual(actual, expected);
    assert.notDeepEqual(actual, Uint8Array.from([...bytes.slice(0, 6), ...expected.slice(6)]));
    assert.equal(manager.task(id).sha256, createHash('sha256').update(expected).digest('hex'));
    assert.equal((await readdir(directory)).some(name => name.endsWith('.part')), false);
  });
});

test('different resource URI cannot force old nonzero range bytes despite a matching strong ETag', async () => {
  await resourceFixture({ status: 206, wrongRange: true }, async (manager, id, directory, calls) => {
    assert.equal(calls.at(-1).headers.Range, 'bytes=0-'); assert.equal(calls.at(-1).headers['If-Range'], undefined);
    assert.equal(manager.task(id).status, 'failed'); assert.equal(manager.task(id).errorCode, 'DOWNLOAD_TRUNCATED');
    await assertNoPartialOrApk(manager, id, directory);
  });
});

test('renamed app metadata preserves the original checked partial filename through continuation', async () => {
  await fixture(async (manager, id, directory) => {
    const originalName = manager.task(id).fileName;
    manager.openDownload = async (_args, options) => {
      assert.equal(options.resume.resourceSha256, resourceSha256);
      return { ...opened(new Response(bytes.slice(4), { status: 206, headers: { ...headers, 'content-length': '4', 'content-range': 'bytes 4-7/8' } })), plan: { ...plan, title: '新的应用名称' } };
    };
    manager.resume(id); await until(() => manager.running.size === 0);
    assert.equal(manager.task(id).status, 'completed'); assert.equal(manager.task(id).title, '新的应用名称'); assert.equal(manager.task(id).fileName, originalName);
    assert.deepEqual(new Uint8Array(await readFile((await manager.completedFile(id)).path)), bytes);
    assert.deepEqual((await readdir(directory)).filter(name => /\.apk(?:\.part)?$/.test(name)), [originalName]);
  });
});
