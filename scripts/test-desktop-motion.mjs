import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import electron from 'electron';
import playwright from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root,'.local/desktop-motion-check'), port = Number(process.env.COOLAPK_MOTION_TEST_PORT || 5245), origin = `http://127.0.0.1:${port}`;
const windowHeight = Number(process.env.COOLAPK_MOTION_TEST_WINDOW_HEIGHT || 900), expectedUrl = origin+'/.local/desktop-motion-check/test.html';
assert.ok(Number.isInteger(port)&&port>0&&port<65536,'invalid isolated test port');
assert.ok(Number.isInteger(windowHeight)&&windowHeight>=400&&windowHeight<=2000,'invalid isolated test window height');
const reportPath = resolve(root,process.env.COOLAPK_MOTION_TEST_REPORT_PATH || 'research/desktop-motion-checks.json');
mkdirSync(directory,{recursive:true});
const baseline = process.argv.includes('--baseline'), css = existsSync(join(root,'src/desktop-motion.css')) ? `import'/src/desktop-motion.css';` : '';
writeFileSync(join(directory,'test.html'),'<html lang="zh-CN"><meta charset="utf-8"><div id="root"></div><script type="module" src="./entry.tsx"></script></html>');
writeFileSync(join(directory,'entry.tsx'),`import React,{Profiler,useLayoutEffect,useState}from'react';import{createRoot}from'react-dom/client';import{FeedCard,Modal,RichText}from'/src/components.tsx';import'/src/styles.css';${css}
const feeds=Array.from({length:100},(_,i)=>({id:String(8000+i),entityType:'feed',uid:'42',username:'测试酷友 '+i,device_title:'<strong>Desktop</strong>',dateline:1801652400,likenum:1,replynum:2,message:'<p>数码生活 · <strong>阅读体验 '+i+'</strong>。<a href="https://www.coolapk.com/t/desktop">查看话题</a></p><p>这是隔离的渲染性能样本，包含安全链接、段落、粗体与多种文本，检查无关状态更新时不会重复解析整份信息流。</p>'}));
function App(){const[tick,set]=useState(0),[open,setOpen]=useState(false),[variant,setVariant]=useState(false);useLayoutEffect(()=>{window.__motion.bump=()=>set(x=>x+1);window.__motion.variant=()=>setVariant(x=>!x);window.__motion.committed=tick},[tick]);const noop=()=>{};return <main><input aria-label="输入测试" value={tick} readOnly/><button className="button" onClick={()=>setOpen(true)}>打开弹窗</button><output data-tick>{tick}</output><Profiler id="feeds" onRender={(_,phase,duration)=>window.__motion.profile.push({phase,duration})}><section className="feed-list" style={{maxWidth:800,margin:'16px auto',height:600,overflowY:'auto'}}>{feeds.map(feed=><FeedCard key={feed.id} feed={feed} onOpen={noop} onUser={noop} onLink={url=>window.__motion.links.push({url,tick})} onLogin={noop} onForward={noop} loggedIn={false} toast={noop}/>)}</section></Profiler><RichText text={variant?'<p>新内容 <strong>已更新</strong><a href="javascript:alert(1)">不可执行</a><script>window.__motion.unsafe=true</script></p>':'<p>原内容</p>'} onLink={url=>window.__motion.links.push({url,tick})}/>{open&&<Modal title="交互测试" onClose={()=>setOpen(false)}><p>弹窗保留焦点和关闭行为。</p></Modal>}</main>};createRoot(document.getElementById('root')).render(<App/>);`);
writeFileSync(join(directory,'preload.cjs'),`const {contextBridge}=require('electron');contextBridge.exposeInMainWorld('motionBridge',{isolated:true});`);
writeFileSync(join(directory,'bootstrap.cjs'),`const{app,BrowserWindow,session}=require('electron');const{writeFileSync}=require('node:fs');app.setPath('userData',process.env.COOLAPK_MOTION_TEST_DATA);globalThis.motionStartup=[];function record(event,details={}){globalThis.motionStartup.push({event,...details});writeFileSync(${JSON.stringify(join(directory,'native-startup.json'))},JSON.stringify(globalThis.motionStartup,null,2))}app.whenReady().then(()=>{record('ready');session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(d,reply)=>reply({cancel:!d.url.startsWith(${JSON.stringify(origin+'/')})}));const window=new BrowserWindow({show:false,width:1280,height:${windowHeight},webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,preload:${JSON.stringify(join(directory,'preload.cjs'))}}});record('window-created',{bounds:window.getBounds(),contentBounds:window.getContentBounds()});window.webContents.on('did-finish-load',()=>record('did-finish-load'));window.webContents.on('did-fail-load',(_,code,description,url)=>record('did-fail-load',{code,description,url}));window.webContents.on('preload-error',(_,path,error)=>record('preload-error',{path,message:error.message}));window.webContents.on('render-process-gone',(_,details)=>record('render-process-gone',details));/* Load only about:blank until Playwright installs instrumentation. */window.loadURL('about:blank').catch(error=>record('blank-load-error',{message:error.message}));}).catch(error=>{record('startup-error',{message:error.message});console.error(error);app.exit(1)});`);
const server=await createServer({root,logLevel:'warn',server:{host:'127.0.0.1',port,strictPort:true}});
const env={...process.env,COOLAPK_MOTION_TEST_DATA:mkdtempSync(join(directory,'userdata-'))};delete env.ELECTRON_RUN_AS_NODE;
let desktop,page;const checks=[],errors=[],consoleMessages=[],failedRequests=[];
const diagnostics={platform:process.platform,node:process.version,expectedUrl,requestedWindow:{width:1280,height:windowHeight},stage:'Vite startup'};
function stage(name){diagnostics.stage=name;console.log('CHECK',name)}
async function rendererSnapshot(){if(!page||page.isClosed())return{closed:true};return page.evaluate(()=>{const root=document.documentElement,node=document.querySelector('.toast'),r=node?.getBoundingClientRect(),s=node&&getComputedStyle(node);return{url:location.href,readyState:document.readyState,feedCount:document.querySelectorAll('[data-feed-id]').length,bridge:!!window.motionBridge?.isolated,committed:window.__motion?.committed,hasBump:typeof window.__motion?.bump==='function',viewport:{innerWidth,innerHeight,clientWidth:root.clientWidth,clientHeight:root.clientHeight,scrollHeight:root.scrollHeight,scale:devicePixelRatio},toast:r&&{left:r.left,width:r.width,center:r.left+r.width/2,layoutCenter:root.clientWidth/2,transform:s.transform,animation:s.animationName}}})}
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
try{
 await server.listen();stage('harness HTTP response');const response=await fetch(expectedUrl);assert.equal(response.status,200,'Vite must serve the generated harness');assert.match(await response.text(),/entry\.tsx/,'harness must contain its module entry');
 stage('Electron launch and first window');
 desktop=await playwright._electron.launch({executablePath:electron,args:[join(directory,'bootstrap.cjs')],env,timeout:30000});
 page=await desktop.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(['warning','error'].includes(message.type())&&consoleMessages.length<30)consoleMessages.push({type:message.type(),text:message.text()})});page.on('requestfailed',request=>{if(failedRequests.length<30)failedRequests.push({url:request.url(),failure:request.failure()?.errorText})});
 await page.addInitScript(()=>{window.__motion={profile:[],links:[],committed:0,parses:0,unsafe:false};const original=DOMParser.prototype.parseFromString;DOMParser.prototype.parseFromString=function(...args){window.__motion.parses++;return original.apply(this,args)};});
 await page.emulateMedia({reducedMotion:'no-preference'});stage('isolated renderer startup');await page.goto(expectedUrl);await page.locator('[data-feed-id]').last().waitFor();assert.equal(await page.locator('[data-feed-id]').count(),100);
 await page.waitForFunction(()=>typeof window.__motion.bump==='function');
 diagnostics.startup=await rendererSnapshot();diagnostics.native=await desktop.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0],preferences=window.webContents.getLastWebPreferences();return{bounds:window.getBounds(),contentBounds:window.getContentBounds(),sandbox:preferences.sandbox,contextIsolation:preferences.contextIsolation,nodeIntegration:preferences.nodeIntegration}});assert.equal(diagnostics.native.sandbox,true);assert.equal(diagnostics.native.contextIsolation,true);assert.equal(diagnostics.native.nodeIntegration,false);assert.equal(diagnostics.startup.bridge,true);writeFileSync(join(directory,'startup.json'),JSON.stringify(diagnostics,null,2));
 stage('100 FeedCards and 12 unrelated parent updates');
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
  stage('cached rich text newest callback');await page.locator('[data-feed-id="8000"]').getByRole('link',{name:'查看话题'}).click();const link=await page.evaluate(()=>window.__motion.links.at(-1));assert.equal(link.tick,15);assert.equal(link.url,'https://www.coolapk.com/t/desktop');checks.push('cached rich text links use the newest callback after parent updates');
  stage('updated rich text security');await page.evaluate(()=>window.__motion.variant());await page.getByText('已更新',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'不可执行',exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.__motion.unsafe),false);checks.push('changed HTML updates immediately while unsafe links/scripts stay filtered');
  stage('modal entry, Escape and focus return');await page.getByRole('button',{name:'打开弹窗',exact:true}).click();const modal=page.getByRole('dialog',{name:'交互测试',exact:true});await modal.waitFor();assert.notEqual(await modal.evaluate(n=>getComputedStyle(n).animationName),'none');assert.equal(await modal.evaluate(n=>n.contains(document.activeElement)),true);await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:'打开弹窗',exact:true}).evaluate(n=>n===document.activeElement),true);checks.push('modal entry animation preserves Escape closing and keyboard focus');
  stage('toast centering with and without a document scrollbar');
  const toastFrames=await page.evaluate(()=>{
   const root=document.documentElement,oldOverflow=root.style.getPropertyValue('overflow-y'),oldPriority=root.style.getPropertyPriority('overflow-y'),frames=[];
   try{for(const overflow of ['hidden','scroll']){
    root.style.setProperty('overflow-y',overflow);const notice=document.createElement('aside');notice.className='toast';notice.textContent='居中的桌面提示';document.body.append(notice);
    try{const animation=notice.getAnimations()[0];if(!animation)throw new Error('Toast entry animation was not created');animation.pause();
     for(const time of [0,65,130]){animation.currentTime=time;const rect=notice.getBoundingClientRect(),style=getComputedStyle(notice);
      // Fixed percentage positioning uses the layout viewport, which excludes
      // a classic Windows scrollbar. innerWidth includes that gutter.
      frames.push({overflow,time,innerWidth,clientWidth:root.clientWidth,center:rect.left+rect.width/2,expectedCenter:root.clientWidth/2,animation:style.animationName,opacity:Number(style.opacity)});
     }
    }finally{notice.remove()}
   }}finally{if(oldOverflow)root.style.setProperty('overflow-y',oldOverflow,oldPriority);else root.style.removeProperty('overflow-y')}
   return frames;
  });
  measurements.toastFrames=toastFrames;assert.equal(toastFrames.length,6);for(const frame of toastFrames){assert.equal(frame.animation,'desktop-feedback-enter');assert.ok(Math.abs(frame.center-frame.expectedCenter)<1,`toast ${frame.overflow} at ${frame.time}ms: ${JSON.stringify(frame)}`);if(frame.time===0)assert.equal(frame.opacity,0);if(frame.time===65)assert.ok(frame.opacity>0&&frame.opacity<1);if(frame.time===130)assert.equal(frame.opacity,1)}
  checks.push('toast remains centered within 1 CSS pixel at 0/65/130ms without a document scrollbar');checks.push('toast remains centered within 1 CSS pixel at 0/65/130ms with a document scrollbar');
  stage('reduced motion');
  await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'打开弹窗',exact:true}).click();await modal.waitFor();assert.equal(await modal.evaluate(n=>getComputedStyle(n).animationName),'none');assert.equal(await page.getByRole('button',{name:'打开弹窗',exact:true}).evaluate(n=>getComputedStyle(n).transitionDuration),'0s');await modal.getByRole('button',{name:'关闭',exact:true}).click();checks.push('reduced motion disables entry and press transitions');
  stage('stationary pagination cards');assert.equal(await page.locator('.feed-card').first().evaluate(n=>getComputedStyle(n).animationName),'none');checks.push('pagination cards have no repeated or staggered entrance animation');
  const old=existsSync(join(directory,'baseline.json'))?JSON.parse(readFileSync(join(directory,'baseline.json'),'utf8')):undefined;
  assert.deepEqual(errors,[]);mkdirSync(dirname(reportPath),{recursive:true});writeFileSync(reportPath,JSON.stringify({mode:'isolated actual Electron; React dev profiler with 100 synthetic FeedCards, 12 parent updates; external requests blocked',checks,baseline:old,optimized:measurements,limits:'Timing is machine/load dependent and is not an FPS or production rendering guarantee. Parse counts and callback/security behavior are deterministic regression assertions.',errors},null,2));console.log(JSON.stringify({checks:checks.length,baseline:old,optimized:measurements}));
 }
}catch(error){
 diagnostics.error={name:error.name,message:error.message,stack:error.stack};diagnostics.errors=errors;diagnostics.console=consoleMessages;diagnostics.failedRequests=failedRequests;
 try{diagnostics.renderer=await rendererSnapshot()}catch(snapshotError){diagnostics.renderer={error:snapshotError.message}}
 if(existsSync(join(directory,'native-startup.json'))){try{diagnostics.nativeStartup=JSON.parse(readFileSync(join(directory,'native-startup.json'),'utf8'))}catch{}}
 try{if(page&&!page.isClosed())await page.screenshot({path:join(directory,'failure.png'),timeout:5000})}catch{}
 writeFileSync(join(directory,'failure.json'),JSON.stringify(diagnostics,null,2));console.error('DESKTOP_MOTION_FAILURE',JSON.stringify(diagnostics));throw error;
}finally{try{await desktop?.close()}finally{await server.close()}}
