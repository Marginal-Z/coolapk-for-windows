import { ApiError, assertLogin, feedForm, flattenEntities } from './client.mjs';
import { prepareSecondhand, secondhandId, secondhandLink, secondhandObject, secondhandPatch, secondhandText } from './secondhand-publishing-models.mjs';
import { accountSettingsAccountGuard } from './account-settings.mjs';
export const SECONDHAND_PUBLISHING_OPERATIONS = Object.freeze(['secondhandPublishCategories', 'secondhandPublishConfig', 'secondhandPublishPresets', 'secondhandAgreementDetail', 'secondhandAgreementState', 'secondhandAcceptAgreement', 'secondhandValidateLink', 'secondhandCreate', 'secondhandEditable', 'secondhandEdit', 'secondhandStatus', 'secondhandClose']);
const input = message => { throw new ApiError(message, 'INPUT'); };
function argsOnly(args, keys) { if (!secondhandObject(args) || Object.keys(args).some(key => !keys.includes(key))) input('闲置操作参数无效'); }
async function request(client, guard, endpoint, query = {}, options) { guard(); let result; try { result = await client.request(endpoint, query, options); } catch (error) { guard(); throw error; } guard(); return result; }
async function write(client, guard, endpoint, query, options) {
  try { return await request(client, guard, endpoint, query, options); }
  catch (error) {
    const status = error.detail?.serverStatus, rejected = Number.isSafeInteger(status) && (status < 0 || status >= 400), challenge = error.detail?.challenge;
    const safe = ['ACCOUNT_CHANGED', 'LOGIN_REQUIRED', 'INPUT'].includes(error.code) || ['API_ERROR', 'VERIFY_REQUIRED'].includes(error.code) && rejected || error.code === 'VERIFY_REQUIRED' && /^[a-f0-9]{32}$/i.test(challenge?.id ?? '') && /^_[A-Za-z0-9_]{1,63}$/.test(challenge?.field ?? '');
    if (error.detail?.responseInvalid || !safe) throw new ApiError('闲置操作提交结果尚未确认，请先刷新核对，避免重复操作', 'WRITE_UNCONFIRMED');
    throw error;
  }
}
function listData(result) { if (!Array.isArray(result?.data)) throw new ApiError('酷安未返回有效的商品配置列表', 'API_ERROR'); return flattenEntities(result.data); }
export function parseSecondhandConfig(result) {
  const groups = listData(result).filter(row => row?.entityType === 'deviceParams').map(row => {
    const key = secondhandText(row.key, 80, true), label = secondhandText(row.title ?? key, 200, true);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || ['constructor', 'prototype', '__proto__'].includes(key) || ![0, 1, '0', '1'].includes(row.checkBox) || !Array.isArray(row.option) || !row.option.length || row.option.length > 200) throw new ApiError('商品配置包含未支持的选择类型', 'UNSUPPORTED');
    const options = row.option.map(value => secondhandText(value, 1000, true));
    if (new Set(options).size !== options.length || Number(row.checkBox) === 0 && key !== 'extra') throw new ApiError('商品配置选择方式尚未支持', 'UNSUPPORTED');
    return { key, label, single: Number(row.checkBox) === 1, required: Number(row.checkBox) === 1, options, allowOther: options.includes('其他') };
  });
  if (groups.length > 100 || new Set(groups.map(group => group.key)).size !== groups.length || !groups.length && listData(result).length) throw new ApiError('商品配置格式尚未支持', 'UNSUPPORTED');
  return groups;
}
export function serializeSecondhandSelections(groups, selections) {
  if (!secondhandObject(selections) || Object.keys(selections).some(key => !groups.some(group => group.key === key))) input('请选择当前商品支持的配置');
  const output = {};
  for (const group of groups) {
    const choices = selections[group.key] ?? [];
    if (!Array.isArray(choices) || choices.length > group.options.length || group.required && !choices.length || group.single && choices.length > 1) input('请填写完整的商品配置');
    if (!choices.length) continue;
    const prepared = choices.map(choice => {
      argsOnly(choice, ['value', 'other']); const value = secondhandText(choice.value, 1000, true), other = choice.other ?? false;
      if (typeof other !== 'boolean' || other && !group.allowOther || !other && (!group.options.includes(value) || value === '其他')) input('商品配置值不在当前选项中');
      return { value, other: other ? '1' : '0' };
    });
    if (new Set(prepared.map(choice => choice.value)).size !== prepared.length) input('商品配置不能重复选择');
    output[group.key] = group.key === 'extra' ? { value: prepared.map(choice => choice.value) } : prepared[0];
  }
  return JSON.stringify(output);
}
async function config(client, guard, args) {
  const productId = secondhandId(args.productId ?? '', true), categoryId = secondhandId(args.categoryId), dealType = args.dealType ?? 0;
  if (![0, 1, 2].includes(dealType)) input('交易类型无效');
  if (categoryId === '104') return [];
  return parseSecondhandConfig(await request(client, guard, '/v6/erShou/config', { productId, ershouTypeId: categoryId, ershou_deal_type: String(dealType) }));
}
async function presets(client, guard, productId) {
  const result = await request(client, guard, '/v6/erShou/configList', { productId: secondhandId(productId) });
  return listData(result).filter(row => row?.entityType === 'deviceParams').map(row => ({ id: secondhandId(String(row.configId || row.id || '')), title: secondhandText(row.configTitle || row.title || '', 1000), ram: secondhandText(row.ram ?? '', 1000), rom: secondhandText(row.rom ?? '', 1000) }));
}
async function checkedConfiguration(client, guard, input, previous) {
  const selected = input.configuration;
  if (selected.type === 'none') return '';
  if (selected.type === 'preserve') return secondhandText(previous?.product_config_source ?? previous?.productConfigSource ?? '', 50000);
  if (selected.type === 'preset') {
    const chosen = (await presets(client, guard, input.productId)).find(row => row.id === selected.id);
    if (!chosen) throw new ApiError('该型号配置已经变化，请重新选择', 'INPUT');
    const field = value => ({ value, other: 0 });
    return JSON.stringify({ configId: chosen.id, configTitle: field(chosen.title), ram: field(chosen.ram), rom: field(chosen.rom) });
  }
  return serializeSecondhandSelections(await config(client, guard, input), selected.selections);
}
async function validateLink(client, guard, source) {
  const link = secondhandLink(source, true), result = await request(client, guard, '/v6/erShou/checkUrl', {}, { method: 'POST', form: { ershou_link: link } });
  if (typeof result?.data !== 'string') throw new ApiError('酷安未返回可用的商品链接', 'API_ERROR');
  return secondhandLink(result.data, true);
}
async function agreementState(client, guard) {
  try { await request(client, guard, '/v6/erShou/checkAgree'); return { accepted: true }; }
  catch (error) { if (error.code === 'API_ERROR' && error.detail?.serverStatus === -1) return { accepted: false }; throw error; }
}
const infoOf = feed => feed?.ershou_info ?? feed?.secondHandInfo;
function ownSecondhand(client, feed, id) {
  const info = infoOf(feed), owner = String(feed?.uid ?? feed?.userInfo?.uid ?? '');
  if (!secondhandObject(feed) || String(feed.id ?? '') !== id || !owner || owner !== String(client.identity.uid)) throw new ApiError('仅可管理当前账号自己的闲置', 'FORBIDDEN');
  if (!secondhandObject(info) || String(info.feed_id ?? info.feedId ?? '') !== id || (feed.feedType ?? feed.feed_type) !== 'ershou') throw new ApiError('这条内容不是有效的二手交易', 'UNSUPPORTED');
  const rawStatus = info.ershou_status ?? info.secondHandStatus, status = Number(rawStatus);
  if (!['string', 'number'].includes(typeof rawStatus) || typeof rawStatus === 'string' && !/^-?\d+$/.test(rawStatus) || !Number.isSafeInteger(status)) throw new ApiError('酷安未返回可确认的交易状态', 'API_ERROR');
  return { info, closed: status < 0 };
}
async function editable(client, guard, id) {
  const result = await request(client, guard, '/v6/feed/changeDetail', { id, rid: '', noticeId: '', fromApi: '' });
  const state = ownSecondhand(client, result.data, id), permission = result.data.enableModify ?? result.data.enable_modify;
  if (permission != null && Number(permission) !== 1) throw new ApiError('此闲置当前不允许编辑或编辑次数已用尽', 'UNSUPPORTED');
  if (Number(result.data.isHtmlArticle ?? result.data.is_html_article ?? 0) !== 0 || Number(result.data.mediaType ?? result.data.media_type ?? 0) !== 0 || result.data.mediaUrl || result.data.media_url) throw new ApiError('此闲置包含尚未支持的文章或视频编辑内容', 'UNSUPPORTED');
  return { feed: result.data, ...state };
}
export function secondhandEditableFields(feed) {
  const info = infoOf(feed), pic = Array.isArray(feed.picArr ?? feed.pic_arr) ? (feed.picArr ?? feed.pic_arr).join(',') : feed.pic;
  const fields = { title: feed.message_title ?? feed.messageTitle ?? '', message: feed.message_source ?? feed.messageSource ?? feed.message_raw_input ?? feed.messageRawInput ?? feed.message, pic: pic ?? '', categoryId: String(info.ershou_type_id ?? info.ershouTypeID ?? '100'), productId: String(info.ershou_product_id ?? info.productId ?? ''), dealType: Number(info.deal_type ?? info.secondHandDealType ?? 0), storeType: Number(info.store_type ?? info.storeType ?? 0), price: String(info.product_price ?? info.price ?? ''), priceType: Number(info.is_face_deal ?? info.secondHandFaceDeal ?? 0) === 1 ? 3 : Number(info.exchange_price_type ?? info.exchangePriceType ?? 0), link: info.link_url ?? info.url ?? '', configuration: { type: 'preserve' }, location: { name: feed.location ?? '', city: info.city ?? feed.location_city ?? feed.locationCity ?? '', country: info.country ?? feed.location_country ?? feed.locationCountry ?? '', province: info.province ?? feed.province ?? '', cityCode: info.city_code ?? info.cityCode ?? feed.city_code ?? feed.cityCode ?? '', latitude: Number(feed.latitude ?? 0), longitude: Number(feed.longitude ?? 0) }, origin: 'general', visibility: Number(feed.publish_status ?? feed.publishStatus ?? 0) === 1 ? 'self' : 'public' };
  if (fields.storeType === 0) throw new ApiError('原闲置尚未包含可确认的身份选项，请在手机核对', 'UNSUPPORTED');
  return prepareSecondhand(fields, true);
}
const aliases = { publish_status: 'publishStatus', long_location: 'longLocation', media_url: 'mediaUrl', media_type: 'mediaType', media_pic: 'mediaPic', message_brief: 'messageBrief', extra_title: 'extraTitle', extra_url: 'extraUrl', extra_key: 'extraKey', extra_pic: 'extraPic', extra_info: 'extraInfo', original_type: 'originalType', is_editInDyh: 'isEditInDyh', forwardid: 'forwardId', fid: 'feedId', dyhId: 'dyh_id', targetType: 'target_type', targetId: 'target_id', disallow_reply: 'disallowReply', vote_score: 'voteScore', replyWithForward: 'reply_with_forward', media_info: 'mediaInfo', insert_product_media: 'insertProductMedia', is_ks_doc: 'isKsDoc', goods_list_id: 'goodsListId' };
function originalTarget(feed) {
  const tid = String(feed.tid ?? '');
  if (/^\d{10,20}$/.test(tid)) {
    const type = { '1': 'apk', '3': 'tag', '5': 'tag', '7': 'product_phone' }[tid.slice(0, -9)], id = String(BigInt(tid.slice(-9)));
    if (!type || id === '0') throw new ApiError('原闲置的发布板块尚未支持，请在手机编辑', 'UNSUPPORTED');
    return { targetType: type, targetId: id };
  }
  const type = feed.targetType ?? feed.target_type, id = feed.targetId ?? feed.target_id;
  if (type != null || id != null) return { targetType: secondhandText(type ?? '', 100), targetId: secondhandText(String(id ?? ''), 200) };
  if (tid && tid !== '0' || feed.targetRow || feed.target_row) throw new ApiError('无法确认原闲置的发布板块，请在手机编辑', 'UNSUPPORTED');
  return { targetType: '', targetId: '' };
}
function publishForm(input, pic, configuration, link, original) {
  const form = feedForm(input.message, pic);
  if (original) for (const key of Object.keys(form)) {
    if (['id', 'message', 'pic', 'type', 'status', 'message_title', 'productId', 'targetType', 'targetId', 'publish_status', 'location', 'location_city', 'location_country', 'latitude', 'longitude'].includes(key)) continue;
    const value = original[key] ?? original[aliases[key]];
    if (value != null) { if (typeof value === 'object') throw new ApiError('原闲置包含无法安全保留的字段，请在手机编辑', 'UNSUPPORTED'); form[key] = secondhandText(typeof value === 'boolean' ? value ? '1' : '0' : String(value), 20000); }
  }
  const target = original ? originalTarget(original) : { targetType: input.origin === 'product' ? 'product_phone' : '', targetId: input.origin === 'product' ? input.productId : '' };
  return Object.assign(form, target, { id: original?.id ?? '', type: 'ershou', message_title: input.title, productId: input.productId, publish_status: input.visibility === 'self' ? 1 : 0, ershou_link: link, ershou_price: input.price, ershouTypeId: input.categoryId, store_type: input.storeType, ershou_deal_type: input.dealType, face_deal: input.priceType === 3 ? 1 : 0, agree: 0, exchange_type: input.priceType, ershou_config: configuration, location: input.location.name, location_city: input.location.city, location_country: input.location.country, province: input.location.province, city_code: input.location.cityCode, latitude: String(input.location.latitude), longitude: String(input.location.longitude) });
}
export async function dispatchSecondhandPublishing(client, operation, args = {}) {
  if (!SECONDHAND_PUBLISHING_OPERATIONS.includes(operation)) return undefined;
  assertLogin(client.identity); const guard = accountSettingsAccountGuard(client);
  if (operation === 'secondhandPublishCategories') { argsOnly(args, []); return request(client, guard, '/v6/erShou/categoryList'); }
  if (operation === 'secondhandAgreementDetail') { argsOnly(args, []); const result = await request(client, guard, '/v6/erShou/agreementDetail'); if (typeof result.data !== 'string' || result.data.length > 1000000) throw new ApiError('酷安未返回有效的交易协议', 'API_ERROR'); return { data: { html: result.data, minimumReadSeconds: 10.5 } }; }
  if (operation === 'secondhandAgreementState') { argsOnly(args, []); return { data: await agreementState(client, guard) }; }
  if (operation === 'secondhandAcceptAgreement') {
    argsOnly(args, ['confirmed']); if (args.confirmed !== true) input('请先阅读并明确同意二手交易协议');
    if ((await agreementState(client, guard)).accepted) return { data: { accepted: true } };
    await write(client, guard, '/v6/erShou/agreement', {}, undefined);
    try { if (!(await agreementState(client, guard)).accepted) throw new Error('not confirmed'); }
    catch (error) { if (['ACCOUNT_CHANGED', 'LOGIN_REQUIRED', 'VERIFY_REQUIRED'].includes(error.code)) throw error; throw new ApiError('协议同意结果尚未确认，请重新读取核对', 'WRITE_UNCONFIRMED'); }
    return { data: { accepted: true } };
  }
  if (operation === 'secondhandPublishConfig') { argsOnly(args, ['categoryId', 'productId', 'dealType']); return { data: await config(client, guard, args) }; }
  if (operation === 'secondhandPublishPresets') { argsOnly(args, ['productId']); return { data: await presets(client, guard, args.productId) }; }
  if (operation === 'secondhandValidateLink') { argsOnly(args, ['link']); return { data: { link: await validateLink(client, guard, args.link) } }; }
  if (operation === 'secondhandEditable') { argsOnly(args, ['id']); const id = secondhandId(args.id), current = await editable(client, guard, id); return { data: { id, closed: current.closed, fields: secondhandEditableFields(current.feed) } }; }
  if (operation === 'secondhandStatus') { argsOnly(args, ['id']); const id = secondhandId(args.id), result = await request(client, guard, '/v6/feed/detail', { id }, { method: 'POST', form: { trace: '' } }); return { data: { id, closed: ownSecondhand(client, result.data, id).closed } }; }
  if (operation === 'secondhandClose') {
    argsOnly(args, ['id', 'confirmed']); if (args.confirmed !== true) input('关闭交易后无法再开启，请明确确认'); const id = secondhandId(args.id);
    const previous = await request(client, guard, '/v6/feed/detail', { id }, { method: 'POST', form: { trace: '' } }), before = ownSecondhand(client, previous.data, id);
    if (before.closed) return { data: { id, closed: true, alreadyClosed: true } };
    const result = await write(client, guard, '/v6/erShou/changeStatus', {}, { method: 'POST', form: { id, status: '-1' } });
    try { if (!ownSecondhand(client, result.data, id).closed) throw new Error('not closed'); }
    catch { throw new ApiError('关闭交易结果尚未确认，请刷新核对', 'WRITE_UNCONFIRMED'); }
    try { const fresh = await request(client, guard, '/v6/feed/detail', { id }, { method: 'POST', form: { trace: '' } }); if (!ownSecondhand(client, fresh.data, id).closed) throw new Error('not closed'); }
    catch (error) { if (['ACCOUNT_CHANGED', 'LOGIN_REQUIRED', 'VERIFY_REQUIRED'].includes(error.code)) throw error; throw new ApiError('交易已提交关闭，回读结果尚未确认，请刷新核对', 'WRITE_UNCONFIRMED'); }
    return { data: { id, closed: true } };
  }
  let original;
  if (operation === 'secondhandEdit') {
    argsOnly(args, ['id', 'patch']); const id = secondhandId(args.id), patch = secondhandPatch(args.patch); const current = await editable(client, guard, id); original = current.feed;
    args = { input: { ...secondhandEditableFields(original), ...patch } };
  } else argsOnly(args, ['input']);
  const prepared = prepareSecondhand(args.input, !!original);
  let pic; try { pic = await client.validatePictures(prepared.pic); } catch (error) { guard(); throw error; } guard();
  if (!pic) input('闲置至少需要一张图片');
  const configuration = await checkedConfiguration(client, guard, prepared, infoOf(original));
  const link = prepared.link ? await validateLink(client, guard, prepared.link) : '';
  if (!(await agreementState(client, guard)).accepted) throw new ApiError('请阅读并同意酷安二手交易协议后发布', 'AGREEMENT_REQUIRED');
  const form = publishForm(prepared, pic, configuration, link, original);
  const result = await write(client, guard, original ? '/v6/feed/changeFeed' : '/v6/feed/createFeed', {}, { method: 'POST', form });
  const id = String(result?.data?.id ?? '');
  if (!/^[1-9]\d{0,19}$/.test(id) || original && id !== String(original.id)) throw new ApiError('酷安未返回可确认的闲置发布结果，请检查最新动态', 'WRITE_UNCONFIRMED');
  try { const saved = ownSecondhand(client, result.data, id); if (original && ownSecondhand(client, original, id).closed && !saved.closed) throw new Error('closed state changed'); }
  catch { throw new ApiError('闲置返回状态尚未确认，请检查最新动态', 'WRITE_UNCONFIRMED'); }
  return result;
}
