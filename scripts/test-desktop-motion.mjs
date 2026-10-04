import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'vite';
import electron from 'electron';
import playwright from 'playwright';

const directory = resolve('.local/desktop-motion-check'), port = Number(process.env.COOLAPK_MOTION_TEST_PORT || 5245), origin = `http://127.0.0.1:${port}`;
mkdirSync(directory,{recursive:true});
const baseline = process.argv.includes('--baseline'), css = existsSync(resolve('src/desktop-motion.css')) ? `import'/src/desktop-motion.css';` : '';
writeFileSync(join(directory,'test.html'),'<html lang="zh-CN"><meta charset="utf-8"><div id="root"></div><script type="module" src="./entry.tsx"></script></html>');
writeFileSync(join(directory,'entry.tsx'),`import React,{Profiler,useLayoutEffect,useState}from'react';import{createRoot}from'react-dom/client';import{FeedCard,Modal,RichText}from'/src/components.tsx';import'/src/styles.css';${css}
const feeds=Array.from({length:100},(_,i)=>({id:String(8000+i),entityType:'feed',uid:'42',username:'测试酷友 '+i,device_title:'<strong>Desktop</strong>',dateline:1801652400,likenum:1,replynum:2,message:'<p>数码生活 · <strong>阅读体验 '+i+'</strong>。<a href="https://www.coolapk.com/t/desktop">查看话题</a></p><p>这是隔离的渲染性能样本，包含安全链接、段落、粗体与多种文本，检查无关状态更新时不会重复解析整份信息流。</p>'}));
function App(){const[tick,set]=useState(0),[open,setOpen]=useState(false),[variant,setVariant]=useState(false);useLayoutEffect(()=>{window.__motion.bump=()=>set(x=>x+1);window.__motion.variant=()=>setVariant(x=>!x);window.__motion.committed=tick},[tick]);const noop=()=>{};return <main><input aria-label="输入测试" value={tick} readOnly/><button className="button" onClick={()=>setOpen(true)}>打开弹窗</button><output data-tick>{tick}</output><Profiler id="feeds" onRender={(_,phase,duration)=>window.__motion.profile.push({phase,duration})}><section className="feed-list" style={{maxWidth:800,margin:'16px auto',height:600,overflowY:'auto'}}>{feeds.map(feed=><FeedCard key={feed.id} feed={feed} onOpen={noop} onUser={noop} onLink={url=>window.__motion.links.push({url,tick})} onLogin={noop} onForward={noop} loggedIn={false} toast={noop}/>)}</section></Profiler><RichText text={variant?'<p>新内容 <strong>已更新</strong><a href="javascript:alert(1)">不可执行</a><script>window.__motion.unsafe=true</script></p>':'<p>原内容</p>'} onLink={url=>window.__motion.links.push({url,tick})}/>{open&&<Modal title="交互测试" onClose={()=>setOpen(false)}><p>弹窗保留焦点和关闭行为。</p></Modal>}</main>};createRoot(document.getElementById('root')).render(<App/>);`);
writeFileSync(join(directory,'preload.cjs'),`const {contextBridge}=require('electron');contextBridge.exposeInMainWorld('motionBridge',{isolated:true});`);
writeFileSync(join(directory,'bootstrap.cjs'),`const{app,BrowserWindow,session}=require('electron');app.setPath('userData',process.env.COOLAPK_MOTION_TEST_DATA);app.whenReady().then(()=>{session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(d,reply)=>reply({cancel:!d.url.startsWith(${JSON.stringify(origin+'/')})}));new BrowserWindow({show:false,width:1280,height:900,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,preload:${JSON.stringify(join(directory,'preload.cjs'))}}}).loadURL(${JSON.stringify(origin+'/.local/desktop-motion-check/test.html')})});`);
const server=await createServer({logLevel:'warn',server:{host:'127.0.0.1',port,strictPort:true}});await server.listen();
const env={...process.env,COOLAPK_MOTION_TEST_DATA:mkdtempSync(join(directory,'userdata-'))};delete env.ELECTRON_RUN_AS_NODE;
let desktop;const checks=[],errors=[];
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
try{
 desktop=await playwright._electron.launch({executablePath:electron,args:[join(directory,'bootstrap.cjs')],env,timeout:30000});
 const page=await desktop.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.__motion={profile:[],links:[],committed:0,parses:0,unsafe:false};const original=DOMParser.prototype.parseFromString;DOMParser.prototype.parseFromString=function(...args){window.__motion.parses++;return original.apply(this,args)};});
 await page.reload();await page.locator('[data-feed-id]').last().waitFor();assert.equal(await page.locator('[data-feed-id]').count(),100);
 await page.waitForFunction(()=>typeof window.__motion.bump==='function');
 for(let i=0;i<3;i++){await page.evaluate(()=>window.__motion.bump());await page.waitForFunction(t=>window.__motion.committed===t,i+1);}
 await page.evaluate(()=>{window.__motion.parses=0;window.__motion.profile=[];});
 const samples=[];
 for(let i=0;i<12;i++){const before=await page.evaluate(()=>window.__motion.committed);const start=performance.now();await page.evaluate(()=>window.__motion.bump());await page.waitForFunction(t=>window.__motion.committed===t,before+1);samples.push(performance.now()-start);}
 const measurements=await page.evaluate(()=>({parseCalls:window.__motion.parses,reactUpdateDurations:window.__motion.profile.filter(x=>x.phase==='update').map(x=>x.duration)}));
 measurements.medianReactUpdateMs=median(measurements.reactUpdateDurations);measurements.medianRoundTripCommitMs=median(samples);measurements.fixtureFeeds=100;measurements.rerenders=12;
 if(baseline){writeFileSync(join(directory,'baseline.json'),JSON.stringify(measurements,null,2));console.log(JSON.stringify({baseline:measurements}));}
 else{
  checks.push('100 actual FeedCards render in an isolated sandboxed Electron window');
  assert.equal(measurements.parseCalls,0,'unrelated parent updates should not reparse feed bodies or device captions');checks.push('12 unrelated parent updates cause no additional HTML parsing');
  await page.locator('[data-feed-id="8000"]').getByRole('link',{name:'查看话题'}).click();const link=await page.evaluate(()=>window.__motion.links.at(-1));assert.equal(link.tick,15);assert.equal(link.url,'https://www.coolapk.com/t/desktop');checks.push('cached rich text links use the newest callback after parent updates');
  await page.evaluate(()=>window.__motion.variant());await page.getByText('已更新',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'不可执行',exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.__motion.unsafe),false);checks.push('changed HTML updates immediately while unsafe links/scripts stay filtered');
  await page.getByRole('button',{name:'打开弹窗',exact:true}).click();const modal=page.getByRole('dialog',{name:'交互测试',exact:true});await modal.waitFor();assert.notEqual(await modal.evaluate(n=>getComputedStyle(n).animationName),'none');assert.equal(await modal.evaluate(n=>n.contains(document.activeElement)),true);await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:'打开弹窗',exact:true}).evaluate(n=>n===document.activeElement),true);checks.push('modal entry animation preserves Escape closing and keyboard focus');
  await page.evaluate(()=>{const notice=document.createElement('aside');notice.className='toast';notice.textContent='居中的桌面提示';document.body.append(notice)});await page.waitForFunction(()=>{const n=document.querySelector('.toast'),r=n?.getBoundingClientRect();return !!r&&Math.abs(r.left+r.width/2-innerWidth/2)<1});checks.push('toast motion preserves its horizontal centering throughout entry');
  await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'打开弹窗',exact:true}).click();await modal.waitFor();assert.equal(await modal.evaluate(n=>getComputedStyle(n).animationName),'none');assert.equal(await page.getByRole('button',{name:'打开弹窗',exact:true}).evaluate(n=>getComputedStyle(n).transitionDuration),'0s');await modal.getByRole('button',{name:'关闭',exact:true}).click();checks.push('reduced motion disables entry and press transitions');
  assert.equal(await page.locator('.feed-card').first().evaluate(n=>getComputedStyle(n).animationName),'none');checks.push('pagination cards have no repeated or staggered entrance animation');
  const old=existsSync(join(directory,'baseline.json'))?JSON.parse(readFileSync(join(directory,'baseline.json'),'utf8')):undefined;
  assert.deepEqual(errors,[]);writeFileSync('research/desktop-motion-checks.json',JSON.stringify({mode:'isolated actual Electron; React dev profiler with 100 synthetic FeedCards, 12 parent updates; external requests blocked',checks,baseline:old,optimized:measurements,limits:'Timing is machine/load dependent and is not an FPS or production rendering guarantee. Parse counts and callback/security behavior are deterministic regression assertions.',errors},null,2));console.log(JSON.stringify({checks:checks.length,baseline:old,optimized:measurements}));
 }
}finally{await desktop?.close();await server.close();}
