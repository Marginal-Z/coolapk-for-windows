const captchaId = new URLSearchParams(location.search).get('captcha');
const statusNode = document.querySelector('#status');
const errorNode = document.querySelector('#error');
const captchaNode = document.querySelector('#captcha');
const retryButton = document.querySelector('#retry');
let activeRun;
let generation = 0;

const current = run => !!run && activeRun === run && !run.finished;
function destroy(instance) { try { instance?.destroy?.(); } catch {} }
function dispose(run) {
  if (!run) return;
  run.finished = true;
  clearTimeout(run.timer);
  if (run.script) { run.script.onload = run.script.onerror = null; run.script.remove(); }
  destroy(run.instance);
}
function failed(run, message) {
  if (!current(run)) return;
  dispose(run);
  statusNode.textContent = '';
  errorNode.textContent = message;
  retryButton.disabled = false;
}
function ready(run, instance) {
  if (!current(run)) { destroy(instance); return; }
  if (instance) run.instance = instance;
  run.ready = true;
  clearTimeout(run.timer);
  statusNode.textContent = '请按上方提示完成验证';
  errorNode.textContent = '';
}
function initialize(run) {
  if (!current(run)) return;
  if (typeof window.initNECaptcha !== 'function') { failed(run, '官方验证组件未能初始化，请重新加载。'); return; }
  try {
    window.initNECaptcha({
      captchaId, element: '#captcha', mode: 'embed', width: '320px',
      lang: 'zh-CN', apiVersion: 2, protocol: 'https', timeout: 12000,
      onReady: instance => ready(run, instance),
      onVerify: (error, data) => {
        if (!current(run)) return;
        if (error) {
          errorNode.textContent = '验证未通过，请按验证码提示重试；需要时可重新加载。';
          return;
        }
        if (typeof data?.validate !== 'string' || !data.validate || data.validate.length > 8000) {
          failed(run, '官方组件未返回有效验证结果，请重新加载。'); return;
        }
        run.finished = true;
        clearTimeout(run.timer);
        retryButton.disabled = true;
        errorNode.textContent = '';
        statusNode.textContent = '验证已完成，正在继续请求…';
        window.verification.complete(`NEC:${captchaId.slice(0, 8)}:${data.validate}`);
      },
    }, instance => {
      if (!current(run)) { destroy(instance); return; }
      run.instance = instance;
      // onload creates the instance; onReady also waits for images and data.
      if (!run.ready) statusNode.textContent = '验证组件已加载，正在获取验证码…';
    }, () => failed(run, '验证码初始化失败，可能是网络或官方服务暂时不可用，请重新加载。'));
  } catch {
    failed(run, '官方验证组件运行失败，请重新加载；持续失败时请更新客户端。');
  }
}
function load() {
  dispose(activeRun);
  const run = activeRun = { generation: ++generation, finished: false, ready: false };
  captchaNode.replaceChildren();
  errorNode.textContent = '';
  statusNode.textContent = '正在加载官方验证组件…';
  retryButton.disabled = false;
  if (!/^[a-f0-9]{32}$/i.test(captchaId || '')) { failed(run, '验证请求配置无效，请关闭窗口后重新读取评论。'); return; }
  run.timer = setTimeout(() => failed(run, '验证码加载超时，请重新加载。若持续失败，请检查网络后重新读取评论。'), 30000);
  if (typeof window.initNECaptcha === 'function') { initialize(run); return; }
  const script = run.script = document.createElement('script');
  // The provider recommends a minute timestamp to avoid retaining old loaders.
  script.src = `https://cstaticdun.126.net/load.min.js?t=${Math.floor(Date.now() / 60000)}`;
  script.onerror = () => failed(run, '官方验证组件下载失败，请检查网络后重新加载。');
  script.onload = () => initialize(run);
  document.head.appendChild(script);
}
retryButton.addEventListener('click', load);
document.querySelector('#cancel').addEventListener('click', () => { dispose(activeRun); window.verification.cancel(); });
window.addEventListener('error', () => {
  if (current(activeRun) && !activeRun.ready) failed(activeRun, '官方验证组件运行失败，请重新加载；持续失败时请更新客户端。');
});
window.addEventListener('unhandledrejection', () => {
  if (current(activeRun) && !activeRun.ready) failed(activeRun, '验证码初始化失败，请重新加载；持续失败时请更新客户端。');
});
document.addEventListener('securitypolicyviolation', event => {
  if (current(activeRun) && ['script-src', 'script-src-elem', 'connect-src', 'img-src'].includes(event.effectiveDirective)) {
    failed(activeRun, '官方验证资源被客户端安全策略阻止，请更新客户端后重新加载。');
  }
});
window.addEventListener('beforeunload', () => dispose(activeRun));
load();
