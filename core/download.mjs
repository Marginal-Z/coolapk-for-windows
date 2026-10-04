import { ApiError, numericId, sanitizeCookie } from './client.mjs';
import { requestHeaders, imageUserAgent } from './auth.mjs';
import { createHash } from 'node:crypto';

export const DOWNLOAD_OPERATIONS = Object.freeze(['apkDownloadPlan', 'apkDownloadVersions', 'apkDownloadVerify']);
// Exact HTTPS hosts only. The official API resolves through dl.coolapk.com to
// imtt.dd.qq.com for APK delivery; that evidenced CDN receives no API credentials.
export const APK_DOWNLOAD_HOSTS = Object.freeze(['api.coolapk.com', 'dl.coolapk.com', 'download.coolapk.com', 'cdn.coolapk.com', 'static.coolapk.com', 'imtt.dd.qq.com']);
const apiHosts = new Set(['api.coolapk.com']);
const fail = (message, code = 'INPUT') => { throw new ApiError(message, code); };
export function packageName(value) { if (typeof value !== 'string' || value.length > 200 || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(value)) fail('应用包名无效'); return value; }
export function apkDownloadUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x20\x7f\\]/.test(value)) fail('安装包下载地址无效');
  let url; try { url = new URL(value); } catch { fail('安装包下载地址无效'); }
  if (url.protocol !== 'https:' || !APK_DOWNLOAD_HOSTS.includes(url.hostname) || url.username || url.password || url.port || url.hash) fail('下载地址不在已适配的酷安官方服务器范围内', 'UNSUPPORTED_DOWNLOAD_HOST');
  if (apiHosts.has(url.hostname) && url.pathname !== '/v6/apk/download') fail('安装包解析地址无效');
  if (url.hostname === 'imtt.dd.qq.com' && (!/^\/[A-Za-z0-9_./-]+\.apk$/i.test(url.pathname) || url.pathname.split('/').some(part => part === '.' || part === '..'))) fail('官方下载 CDN 的安装包路径无效', 'UNSUPPORTED_DOWNLOAD_HOST');
  return url;
}
export function buildApkDownloadUrl(pn, aid, vc) {
  const url = new URL('https://api.coolapk.com/v6/apk/download');
  url.searchParams.set('pn', packageName(pn)); url.searchParams.set('aid', numericId(aid)); url.searchParams.set('vc', numericId(vc)); url.searchParams.set('extra', ''); return url.toString();
}
const codeOf = value => value?.versionCode ?? value?.versioncode ?? value?.version_code ?? value?.apkversioncode ?? value?.apkVersionCode ?? value?.apk_version_code;
function currentCode(detail) {
  if (codeOf(detail) != null) return codeOf(detail);
  const source = detail?.extraAnalysisData;
  if (typeof source !== 'string' || source.length > 16000) return undefined;
  try { const encoded = source.split('~')[0]; if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return undefined; return codeOf(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))); } catch { return undefined; }
}
const nameOf = value => String(value?.versionName ?? value?.apkversion ?? value?.version ?? value?.version_name ?? '');
function versionRows(result) {
  const value = result?.data, rows = Array.isArray(value) ? value : [value?.list, value?.rows, value?.entities].find(Array.isArray);
  if (!rows) fail('酷安返回的历史版本列表结构异常', 'API_ERROR'); return rows;
}
async function appDetail(client, pn) {
  const result = await client.request('/v6/apk/detail', { id: pn, installed: 0 }, { method: 'POST', form: { extraAnalysisData: '' } }), detail = result.data;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) fail('酷安未返回应用详情', 'API_ERROR');
  const actual = detail.packageName || detail.package_name || detail.package;
  if (actual && actual !== pn) fail('酷安返回的应用与请求包名不匹配', 'API_ERROR');
  return { detail, id: numericId(detail.aid ?? detail.id ?? detail.entityId ?? detail.apkId ?? detail.apkid) };
}
export async function downloadVersions(client, args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) fail('历史版本参数无效');
  const pn = packageName(args.packageName), { detail, id } = await appDetail(client, pn);
  const page = Number(args.page ?? 1); if (!Number.isInteger(page) || page < 1 || page > 1000) fail('历史版本页码无效');
  const result = await client.request('/v6/apk/downloadVersionList', { id, page });
  const rows = versionRows(result);
  return { ...result, data: rows.map(item => ({ ...item, downloadVersionCode: codeOf(item) == null ? '' : String(codeOf(item)), downloadVersionName: nameOf(item) })), apkId: id, packageName: pn, currentVersionCode: String(currentCode(detail) ?? ''), hasMore: result.hasMore ?? rows.length > 0 };
}
export async function prepareApkDownload(client, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !['packageName', 'versionCode', 'title', 'versionPage'].includes(key))) fail('下载参数包含未支持的字段');
  const pn = packageName(args.packageName), { detail, id } = await appDetail(client, pn), current = numericId(currentCode(detail));
  const requested = args.versionCode == null || args.versionCode === '' ? current : numericId(args.versionCode);
  let version = detail;
  if (requested !== current) {
    const page = Number(args.versionPage ?? 1); if (!Number.isInteger(page) || page < 1 || page > 1000) fail('历史版本页码无效');
    const rows = versionRows(await client.request('/v6/apk/downloadVersionList', { id, page }));
    version = rows.find(item => String(codeOf(item)) === requested);
    if (!version) fail('服务端历史版本列表未提供此版本，不能猜测下载地址', 'UNSUPPORTED_VERSION');
  }
  return { data: { packageName: pn, apkId: id, versionCode: requested, versionName: nameOf(version), title: String(detail.appName || detail.title || pn), requestUrl: buildApkDownloadUrl(pn, id, requested), historical: requested !== current } };
}
export async function verifyApkDownload(client, args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) fail('下载校验参数无效');
  const pn = packageName(args.packageName), request = apkDownloadUrl(args.requestUrl), target = apkDownloadUrl(args.downloadUrl);
  if (!apiHosts.has(request.hostname) || request.searchParams.get('pn') !== pn) fail('下载校验与应用包名不匹配');
  const result = await client.request('/v6/apk/downloadVerify', {}, { method: 'POST', form: { apkName: pn, requestUrl: request.toString(), downloadUrl: target.toString() } });
  if (result.data == null || typeof result.data === 'string' && !result.data.trim() || result.data === false || result.data === 0) fail('酷安下载校验未通过，已拒绝保存安装包', 'DOWNLOAD_VERIFY_FAILED');
  return { data: { verified: true } };
}
export async function openApkDownload(client, plan, { signal, resume } = {}) {
  const expected = buildApkDownloadUrl(plan.packageName, plan.apkId, plan.versionCode);
  if (plan.requestUrl !== expected) fail('下载请求与官方应用版本不匹配');
  if (resume && (!Number.isSafeInteger(resume.offset) || resume.offset < 4 || resume.offset >= resume.total || resume.total > 2 * 1024 ** 3 || !Number.isSafeInteger(resume.total) || !/^"[\x21\x23-\x7e]{1,256}"$/.test(resume.etag) || !/^[a-f0-9]{64}$/.test(resume.resourceSha256) || String(resume.versionCode) !== String(plan.versionCode))) fail('断点信息与安装包版本不匹配', 'DOWNLOAD_RESUME');
  const identity = String(client.identity?.uid || ''), cookie = client.cookie, device = client.deviceCode;
  const assertCurrent = () => { if (String(client.identity?.uid || '') !== identity || client.cookie !== cookie || client.deviceCode !== device) fail('账号已切换，请重试下载', 'ACCOUNT_CHANGED'); if (signal?.aborted) throw signal.reason || new ApiError('下载已取消', 'CANCELED'); };
  let url = apkDownloadUrl(expected), method = 'POST';
  const assertPlanRoute = target => {
    if (!apiHosts.has(target.hostname)) return;
    for (const [field, value] of [['pn', plan.packageName], ['aid', String(plan.apkId)], ['vc', String(plan.versionCode)]]) {
      if (target.searchParams.getAll(field).length !== 1 || target.searchParams.get(field) !== value) fail('官方解析重定向与请求应用或版本不匹配', 'DOWNLOAD_IDENTITY');
    }
  };
  const abortSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30 * 60000)]) : AbortSignal.timeout(30 * 60000);
  for (let hop = 0; hop <= 8; hop++) {
    assertCurrent(); assertPlanRoute(url); const isApi = apiHosts.has(url.hostname), headers = { 'User-Agent': imageUserAgent(), 'Accept-Encoding': 'identity', Range: 'bytes=0-' };
    // The resolver uses POST. Apply byte ranges only to the final CDN GET;
    // If-Range with a strong validator prevents joining different files.
    const resourceSha256 = createHash('sha256').update(url.toString()).digest('hex');
    const rangeOffset = resume && !isApi && method === 'GET' && resourceSha256 === resume.resourceSha256 ? resume.offset : 0;
    if (rangeOffset) { headers.Range = `bytes=${rangeOffset}-`; headers['If-Range'] = resume.etag; }
    if (isApi) { Object.assign(headers, requestHeaders(client.deviceCode)); const cookie = typeof client.requestCookie === 'function' ? client.requestCookie() : client.cookie ? sanitizeCookie(client.cookie) : ''; if (cookie) headers.Cookie = cookie; }
    const options = { method, headers, redirect: 'manual', signal: abortSignal };
    if (isApi && method === 'POST') { headers['Content-Type'] = 'application/x-www-form-urlencoded'; options.body = new URLSearchParams({ nd: '1', extraAnalysisData: '' }).toString(); }
    let response;
    try { response = await client.fetch(url, options); } catch (error) { assertCurrent(); if (error?.code === 'ACCOUNT_CHANGED') throw error; fail(error?.name === 'TimeoutError' ? '下载连接超时，请重试' : '无法连接下载服务器，请重试', 'NETWORK'); }
    try { assertCurrent(); } catch (error) { await response.body?.cancel(); throw error; }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location || hop === 8) fail('安装包下载重定向异常', 'DOWNLOAD_REDIRECT');
      const next = apkDownloadUrl(new URL(location, url).toString());
      assertPlanRoute(next);
      // Credentials apply only to the official API download route. A CDN gets a fresh GET.
      if (!apiHosts.has(next.hostname) || response.status === 303 || [301, 302].includes(response.status) && method === 'POST') method = 'GET';
      url = next; continue;
    }
    if (!response.ok) { await response.body?.cancel(); fail(`安装包下载返回 HTTP ${response.status}`, 'HTTP'); }
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (/^(?:text\/|application\/(?:json|xhtml\+xml))/.test(contentType)) { await response.body?.cancel(); fail('下载响应是网页或接口内容，不是安装包', 'DOWNLOAD_CONTENT'); }
    if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') { await response.body?.cancel(); fail('安装包响应不能使用压缩传输', 'DOWNLOAD_CONTENT'); }
    if (response.status === 206) {
      const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i), start = rangeOffset;
      if (!range || Number(range[1]) !== start || Number(range[2]) + 1 !== Number(range[3]) || start && (Number(range[3]) !== resume.total || response.headers.get('etag') !== resume.etag)) { await response.body?.cancel(); fail('服务器返回的安装包范围或文件标识已改变，请重新下载', 'DOWNLOAD_TRUNCATED'); }
    }
    try { await verifyApkDownload(client, { packageName: plan.packageName, requestUrl: expected, downloadUrl: url.toString() }); assertCurrent(); }
    catch (error) { await response.body?.cancel(); throw error; }
    return { response, plan, requestUrl: expected, finalUrl: url.toString(), resourceSha256, rangeOffset: response.status === 206 ? rangeOffset : 0, verified: true, assertCurrent };
  }
  fail('安装包下载重定向次数过多', 'DOWNLOAD_REDIRECT');
}
export async function dispatchDownload(client, operation, args = {}) {
  if (!DOWNLOAD_OPERATIONS.includes(operation)) return undefined;
  if (operation === 'apkDownloadPlan') return prepareApkDownload(client, args);
  if (operation === 'apkDownloadVersions') return downloadVersions(client, args);
  return verifyApkDownload(client, args);
}
