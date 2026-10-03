const captchaId = new URLSearchParams(location.search).get('captcha');
const statusNode = document.querySelector('#status');
const errorNode = document.querySelector('#error');
document.querySelector('#cancel').addEventListener('click', () => window.verification.cancel());
function fail(message) { statusNode.textContent = ''; errorNode.textContent = message; }
const script = document.createElement('script');
script.src = 'https://cstaticdun.126.net/load.min.js';
const timeout = setTimeout(() => fail('验证组件加载超时，请关闭窗口后重试。'), 20000);
script.onerror = () => { clearTimeout(timeout); fail('验证组件加载失败，请检查网络。'); };
script.onload = () => {
  clearTimeout(timeout);
  if (!window.initNECaptcha || !/^[a-f0-9]{32}$/i.test(captchaId || '')) { fail('验证组件配置无效。'); return; }
  window.initNECaptcha({ captchaId, element: '#captcha', mode: 'embed', width: '320px', lang: 'zh-CN', apiVersion: 2, onVerify: (error, data) => {
    if (error) { fail(error.message || '验证失败，请重试。'); return; }
    if (data?.validate) { statusNode.textContent = '验证已完成，正在继续请求…'; window.verification.complete(`NEC:${captchaId.slice(0, 8)}:${data.validate}`); }
  } }, () => { statusNode.textContent = '请完成上方验证'; }, error => fail(error?.message || '验证初始化失败。'));
};
document.head.appendChild(script);
