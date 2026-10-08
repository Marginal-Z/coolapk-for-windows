'use strict';
import { fetchLatestRelease, LATEST_PAGE } from './release.js';
const shots = {
  headlines: {label:'社区浏览',alt:'Coolapk desktop 社区浏览真实界面：宽屏双列动态、顶部搜索与侧栏导航',caption:'更宽的视野，看内容，也看生活。'},
  home: {label:'首页',alt:'Coolapk desktop 首页真实界面：活动轮播、十个快捷入口与推荐栏目',caption:'推荐、活动和常用入口，从首页开始发现。'},
  hot: {label:'热榜',alt:'Coolapk desktop 热榜真实界面：热门动态、周榜与月榜切换',caption:'看看今天，酷友们正在聊什么。'},
  photos: {label:'酷图',alt:'Coolapk desktop 酷图真实界面：摄影和壁纸动态以双列卡片展示',caption:'摄影、壁纸与生活瞬间，在大屏幕细看。'},
  topics: {label:'话题广场',alt:'Coolapk desktop 话题广场真实界面：分类导航、话题图标与热度',caption:'顺着兴趣，找到聊得来的话题。'},
  apps: {label:'应用与游戏',alt:'Coolapk desktop 应用与游戏真实界面：分类筛选、应用图标和评分',caption:'按分类发现应用，找到适合自己的工具。'},
  settings: {label:'个性化设置',alt:'Coolapk desktop 个性化设置真实界面：材质效果、主题颜色与夜间模式',caption:'主题、背景与材质，调整成自己的习惯。'}
};
const tabs = [...document.querySelectorAll('[role="tab"][data-shot]')];
const screenshot = document.querySelector('#screenshot');
const panel = document.querySelector('#screenshot-panel');
const openButton = document.querySelector('.screenshot-open');
const imageDialog = document.querySelector('.image-dialog');
let currentShot='headlines';
function selectShot(key,focus=false) {
  const shot=shots[key]; if(!shot) return;
  currentShot=key;
  for(const tab of tabs){const active=tab.dataset.shot===key;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;if(active&&focus){tab.focus({preventScroll:true});tab.scrollIntoView({block:'nearest',inline:'nearest'});}}
  screenshot.src=`assets/${key}.png`; screenshot.alt=shot.alt;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) screenshot.animate([{opacity:.45,transform:'translateY(3px)'},{opacity:1,transform:'none'}],{duration:260,easing:'ease-out'});
  panel.setAttribute('aria-labelledby',`tab-${key}`);
  openButton.setAttribute('aria-label',`放大查看${shot.label}截图`);
  document.querySelector('#screenshot-caption').textContent=shot.caption;
}
tabs.forEach((tab,index)=>{
  tab.addEventListener('click',()=>selectShot(tab.dataset.shot));
  tab.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index-1+tabs.length)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();selectShot(tabs[next].dataset.shot,true);});
});
document.querySelectorAll('[data-select-shot]').forEach(link=>link.addEventListener('click',()=>selectShot(link.dataset.selectShot)));
function openScreenshot(){
  const shot=shots[currentShot];
  const image=imageDialog.querySelector('img');image.src=`assets/${currentShot}.png`;image.alt=shot.alt;
  document.querySelector('#image-dialog-title').textContent=shot.label;
  imageDialog.showModal();document.body.classList.add('dialog-open');imageDialog.querySelector('.image-dialog-scroll').scrollTop=0;
}
openButton.addEventListener('click',openScreenshot);
document.querySelector('.preview-expand').addEventListener('click',openScreenshot);
document.querySelector('.image-close').addEventListener('click',()=>imageDialog.close());
imageDialog.addEventListener('close',()=>document.body.classList.remove('dialog-open'));
imageDialog.addEventListener('click',event=>{if(event.target===imageDialog){const box=imageDialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)imageDialog.close();}});
const demo=document.querySelector('.material-demo');
const enabled=document.querySelector('#material-enabled');
const choices=[...document.querySelectorAll('input[name="material"]')];
const labels={glass:'液态玻璃',blur:'背景模糊',transparent:'半透明',disabled:'纯色界面'};
function updateMaterial(){const selected=choices.find(choice=>choice.checked)?.value||'glass';const material=enabled.checked?selected:'disabled';demo.dataset.material=material;demo.querySelector('.material-badge').textContent=labels[material];for(const choice of choices)choice.disabled=!enabled.checked;}
enabled.addEventListener('change',updateMaterial);for(const choice of choices)choice.addEventListener('change',updateMaterial);updateMaterial();

const status = document.querySelector('.release-status');
const downloads = { installer: document.querySelector('.download-installer'), portable: document.querySelector('.download-portable') };
let releaseRequest;
function resetDownloads() {
  for (const link of Object.values(downloads)) link.href = LATEST_PAGE;
  for (const label of document.querySelectorAll('[data-release-version]')) label.textContent = '最新正式发行版';
  for (const label of document.querySelectorAll('[data-download-size]')) label.textContent = 'Windows x64 · 版本由 GitHub 确认';
}
function refreshRelease() {
  if (releaseRequest) return releaseRequest;
  releaseRequest = fetchLatestRelease().then(release => {
    for (const label of document.querySelectorAll('[data-release-version]')) label.textContent = `v${release.version}`;
    for (const [kind, link] of Object.entries(downloads)) {
      const asset = release.assets[kind];
      link.href = asset?.url || release.releaseUrl;
      document.querySelector(`[data-download-size="${kind}"]`).textContent = asset ? `Windows x64 · ${(asset.size / 1024 / 1024).toFixed(1)} MB` : 'Windows x64 · 前往发行页查看';
    }
    status.textContent = '下载与 GitHub 最新正式发行版自动同步。';
    return release;
  }).catch(() => {
    resetDownloads();
    status.textContent = '暂时无法读取版本。下载按钮仍可打开 GitHub 最新发行页。';
    return null;
  }).finally(() => { releaseRequest = null; });
  return releaseRequest;
}
refreshRelease();
// Revalidate on each ordinary download click, including a tab left open during a new release.
for (const link of Object.values(downloads)) link.addEventListener('click', async event => {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  link.setAttribute('aria-busy', 'true');
  await refreshRelease();
  link.removeAttribute('aria-busy');
  window.location.assign(link.href);
});
window.addEventListener('pageshow', event => { if (event.persisted) refreshRelease(); });

// A single lightweight product-stage interaction, no perpetual render loop.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const stage = document.querySelector('.showcase');
stage.addEventListener('pointermove', event => {
  if (reducedMotion.matches || event.pointerType !== 'mouse') return;
  const bounds = stage.getBoundingClientRect();
  panel.style.setProperty('--stage-tilt', `${((event.clientY - bounds.top) / bounds.height - .5) * -3}deg`);
});
stage.addEventListener('pointerleave', () => panel.style.removeProperty('--stage-tilt'));
reducedMotion.addEventListener('change', () => panel.style.removeProperty('--stage-tilt'));

const sectionLinks = [...document.querySelectorAll('.site-header nav a')];
const visibleSections = new Map();
const sectionObserver = new IntersectionObserver(entries => {
  for (const entry of entries) visibleSections.set(entry.target.id, entry.isIntersecting);
  const active = sectionLinks.find(link => visibleSections.get(link.hash.slice(1)));
  for (const link of sectionLinks) {
    if (link === active) link.setAttribute('aria-current','location');
    else link.removeAttribute('aria-current');
  }
}, { rootMargin: '-20% 0px -45% 0px' });
for (const link of sectionLinks) sectionObserver.observe(document.querySelector(link.hash));

// Keep the address clean while preserving the same-page navigation behavior.
function clearFragment() {
  if (location.hash) history.replaceState(null, '', `${location.pathname}${location.search}`);
}
clearFragment();
for (const link of document.querySelectorAll('a[href^="#"]')) {
  link.addEventListener('click', event => {
    const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
    clearFragment();
    if (link.classList.contains('skip-link')) target.focus({ preventScroll: true });
  });
}
