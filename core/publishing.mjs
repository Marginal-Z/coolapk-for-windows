import { ApiError, assertLogin, numericId, feedForm } from './client.mjs';
import { officialImageUrl } from './upload.mjs';
import { videoUrl } from './video.mjs';
const fail = message => { throw new ApiError(message, 'INPUT'); };
const text = (s, n) => { if (typeof s !== 'string' || s.length > n || /[\0\r]/.test(s)) fail('发布内容无效'); return s.trim(); };
export function articleModels(source, pictures = []) {
  const message = text(source, 24000);
  if (!message || [...message].length > 12000) fail('文章正文不能为空且最多 12000 字');
  return [{ type: 'text', message }, ...pictures.map(url => ({ type: 'image', url: officialImageUrl(url), description: '' }))];
}
export function applyPublishOptions(form, raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('发布选项无效');
  const allowed = new Set(['targetType', 'targetId', 'subTypeId', 'subData', 'visibleStatus', 'largeCover', 'htmlArticle', 'messageTitle', 'messageCover', 'originalType', 'extraUrl', 'dyhId', 'mediaUrl', 'mediaInfo']);
  if (Object.keys(raw).some(key => !allowed.has(key))) fail('发布选项包含未知字段');
  for (const key of ['htmlArticle', 'largeCover']) if (raw[key] != null && typeof raw[key] !== 'boolean') fail('发布模式选项必须为布尔值');
  const targetType = text(raw.targetType ?? '', 30), targetId = text(String(raw.targetId ?? ''), 200);
  if (!['', 'tag', 'apk', 'product_phone'].includes(targetType) || !!targetType !== !!targetId) fail('请选择完整的发布板块');
  if (targetType === 'product_phone') numericId(targetId);
  if (raw.visibleStatus != null && ![1, -1].includes(raw.visibleStatus)) fail('可见范围无效');
  if (raw.originalType != null && (!Number.isInteger(raw.originalType) || raw.originalType < 0 || raw.originalType > 3)) fail('内容声明无效');
  if (raw.htmlArticle && raw.largeCover) fail('文章不能同时使用大图动态模式');
  if (raw.htmlArticle && !text(raw.messageTitle ?? '', 100)) fail('文章标题不能为空');
  if (!raw.htmlArticle && (raw.messageTitle || raw.messageCover)) fail('标题和题图仅支持文章');
  let extraUrl = '';
  if (raw.extraUrl) { try { const url = new URL(text(raw.extraUrl, 4096)); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail('附加链接无效'); extraUrl = url.href; } catch { fail('附加链接无效'); } }
  Object.assign(form, { targetType, targetId, publish_status: raw.visibleStatus === -1 ? 1 : 0, original_type: raw.originalType ?? 0, extra_url: extraUrl, dyhId: raw.dyhId ? numericId(raw.dyhId) : '', is_html_article: raw.htmlArticle ? 1 : raw.largeCover ? 2 : 0, message_title: raw.htmlArticle ? text(raw.messageTitle, 100) : '', message_cover: raw.messageCover ? officialImageUrl(raw.messageCover) : '' });
  if (targetType === 'apk') form.type = 'comment';
  if (raw.mediaUrl) {
    form.media_url = videoUrl(raw.mediaUrl);
    let info; try { info = JSON.parse(text(raw.mediaInfo, 20000)); } catch { fail('视频信息无效'); }
    if (!info || typeof info !== 'object' || Array.isArray(info) || info.mediaType !== 'video' || !Number.isFinite(info.duration) || info.duration <= 0) fail('视频信息无效');
    videoUrl(info.cover);
    let params; try { params = JSON.parse(text(info.requestParams, 10000)); } catch { fail('视频请求参数无效'); }
    if (!params || typeof params !== 'object' || Array.isArray(params)) fail('视频请求参数无效');
    if (params['普通']?.['0'] !== form.media_url) fail('视频信息与地址不匹配');
    form.media_info = JSON.stringify(info);
  } else if (raw.mediaInfo) fail('缺少视频地址');
  if (raw.subTypeId != null && String(raw.subTypeId) !== '') {
    const sub = String(raw.subTypeId), data = text(String(raw.subData ?? ''), 4000);
    if (targetType !== 'product_phone' || !/^[0-6]$/.test(sub)) fail('产品子板块无效');
    if (['3', '4'].includes(sub) && !form.pic) fail('上手或样张至少需要一张图片');
    if (sub === '1' && !(Number(data) > 0 && Number.isFinite(Number(data)))) fail('续航时长无效');
    if (sub === '5' && !/^[1-5]$/.test(data)) fail('反馈严重度无效');
    if (['2', '6'].includes(sub)) {
      let value; try { value = JSON.parse(data); } catch { fail('产品子板块数据无效'); }
      if (sub === '2') { const keys = ['antutu_score', 'geek_bench_single_score', 'geek_bench_multi_score', '3d_mark_score']; if (!value || Array.isArray(value) || !Object.keys(value).length || Object.entries(value).some(([k, v]) => !keys.includes(k) || typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) fail('跑分数据无效'); }
      else if (!value || Array.isArray(value) || typeof value.final_price !== 'number' || !Number.isFinite(value.final_price) || !(value.final_price > 0 && Number.isInteger(value.config_id) && value.config_id > 0 && typeof value.config_name === 'string' && value.config_name.trim())) fail('到手价需要价格和配置');
    }
    form.tsubid = sub; form.tsubdata = data;
  }
  return form;
}
export async function publishAdvanced(client, args) {
  assertLogin(client.identity);
  const pictures = args.pic ? await client.validatePictures(args.pic) : '';
  const article = args.options?.htmlArticle === true;
  const message = article ? JSON.stringify(articleModels(args.message, pictures ? pictures.split(',') : [])) : text(args.message ?? '', 10000);
  if (!message && !pictures && !args.options?.mediaUrl) fail('发布内容不能为空');
  if (!article && [...message].length > 1000) fail('普通动态不能超过 1000 字');
  const form = applyPublishOptions(feedForm(message, article ? '' : pictures), args.options);
  const result = await client.request('/v6/feed/createFeed', {}, { method: 'POST', form });
  if (!result.data?.id) throw new ApiError('服务端未返回发布结果，请刷新确认，避免重复发布');
  return result;
}

export async function editArticle(client, args) {
  assertLogin(client.identity);
  const id = numericId(args.id), result = await client.editableFeed(id), original = result.data;
  if (Number(original.isHtmlArticle ?? original.is_html_article) !== 1 || Number(original.mediaType ?? original.media_type ?? 0) > 0 || (original.mediaUrl ?? original.media_url)) fail('这条内容不是可编辑的图文文章');
  const permission = original.enableModify ?? original.enable_modify;
  if (permission != null && Number(permission) !== 1) throw new ApiError('服务端不允许修改此文章', 'UNSUPPORTED');
  const title = text(args.title, 100); if (!title) fail('文章标题不能为空');
  const cover = args.cover ? officialImageUrl(text(args.cover, 2048)) : '';
  let source; try { source = typeof original.message === 'string' ? JSON.parse(original.message) : original.message; } catch { fail('原文模型无法识别，已停止修改'); }
  if (!Array.isArray(source) || !Array.isArray(args.models) || args.models.length > 300 || source.some(model => !model || !['text', 'image', 'card', 'shareUrl', 'else', 'top', 'bottom', 'relativeInfo'].includes(model.type))) fail('文章包含无法识别的模型，已停止修改');
  const preserved = source.filter(model => ['card', 'shareUrl', 'else'].includes(model.type)).map(model => JSON.stringify(model));
  const submittedPreserved = []; let length = 0, hasText = false;
  const models = args.models.map(model => {
    if (model?.type === 'text') { const message = text(model.message, 24000); length += [...message].length; hasText ||= !!message; return { type: 'text', message }; }
    if (model?.type === 'image') return { type: 'image', url: officialImageUrl(text(model.url, 2048)), description: text(model.description ?? '', 2000) };
    if (['card', 'shareUrl', 'else'].includes(model?.type)) { const serialized = JSON.stringify(model); if (serialized.length > 20000) fail('保留模型过长'); submittedPreserved.push(serialized); return model; }
    return fail('文章正文模型无效');
  });
  if (!hasText || length > 12000) fail('文章正文不能为空且最多 12000 字');
  if (JSON.stringify(preserved.sort()) !== JSON.stringify(submittedPreserved.sort())) fail('保留内容不可更改或删除');
  const aliases = { publish_status: 'publishStatus', long_location: 'longLocation', media_url: 'mediaUrl', media_type: 'mediaType', media_pic: 'mediaPic', message_brief: 'messageBrief', extra_title: 'extraTitle', extra_url: 'extraUrl', extra_key: 'extraKey', extra_pic: 'extraPic', extra_info: 'extraInfo', original_type: 'originalType', is_editInDyh: 'isEditInDyh', forwardid: 'forwardId', dyhId: 'dyh_id', targetType: 'target_type', productId: 'product_id', targetId: 'target_id', location_city: 'locationCity', location_country: 'locationCountry', disallow_reply: 'disallowReply', vote_score: 'voteScore', replyWithForward: 'reply_with_forward', media_info: 'mediaInfo', insert_product_media: 'insertProductMedia', is_ks_doc: 'isKsDoc', goods_list_id: 'goodsListId', city_code: 'cityCode' };
  const form = feedForm(JSON.stringify(models), '');
  for (const field of [...Object.keys(form), 'province', 'city_code']) {
    if (['id', 'message', 'pic', 'message_title', 'message_cover', 'is_html_article'].includes(field)) continue;
    const value = original[field] ?? original[aliases[field]];
    if (value != null) form[field] = typeof value === 'boolean' ? (value ? '1' : '0') : typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  Object.assign(form, { id, message_title: title, message_cover: cover, is_html_article: 1 });
  const updated = await client.request('/v6/feed/changeFeed', {}, { method: 'POST', form });
  if (String(updated.data?.id) !== id) throw new ApiError('服务端未返回修改后的文章，请刷新确认');
  return updated;
}
