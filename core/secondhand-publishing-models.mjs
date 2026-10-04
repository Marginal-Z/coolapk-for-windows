export const SECONDHAND_PUBLISH_LIMITS = Object.freeze({ title: 50, pictures: 9, bodyTransport: 10000 });
export const SECONDHAND_DEAL_TYPES = Object.freeze([{ value: 0, label: '出售' }, { value: 1, label: '收购' }, { value: 2, label: '换机' }]);
export const SECONDHAND_STORE_TYPES = Object.freeze([{ value: 2, label: '个人' }, { value: 1, label: '商家' }]);
export const SECONDHAND_PRICE_TYPES = Object.freeze([{ value: 0, label: '普通价格' }, { value: 1, label: '卖家加钱' }, { value: 2, label: '买家加钱' }, { value: 3, label: '价格面议' }]);
const fail = message => { const error = new Error(message); error.code = 'INPUT'; throw error; };
export const secondhandObject = value => value && typeof value === 'object' && !Array.isArray(value);
export function secondhandText(value, max, required = false) { if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) || required && !value.trim()) fail('闲置内容或字段无效'); return value.trim(); }
export function secondhandId(value, optional = false) { if (optional && value === '') return ''; if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value)) fail('闲置编号无效'); return value; }
export function secondhandLink(value, required = false) {
  const source = secondhandText(value, 4096, required); if (!source) return '';
  let url; try { url = new URL(source); } catch { fail('商品链接无效'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) fail('商品链接无效');
  return source;
}
const fields = ['title', 'message', 'pic', 'categoryId', 'productId', 'dealType', 'storeType', 'price', 'priceType', 'link', 'configuration', 'location', 'origin', 'visibility'];
export function secondhandPatch(value) {
  if (!secondhandObject(value) || !Object.keys(value).length || Object.keys(value).some(key => !fields.includes(key))) fail('闲置修改字段无效');
  return structuredClone(value);
}
export function prepareSecondhand(value, editing = false) {
  if (!secondhandObject(value) || Object.keys(value).some(key => !fields.includes(key))) fail('闲置发布字段无效');
  const title = secondhandText(value.title ?? '', 50), message = secondhandText(value.message, SECONDHAND_PUBLISH_LIMITS.bodyTransport, true), pic = secondhandText(value.pic, 20000, true);
  if (pic.split(',').length > 9 || pic.split(',').some(part => !part.trim())) fail('闲置至少需要一张图片，最多9张');
  const categoryId = secondhandId(value.categoryId), productId = secondhandId(value.productId ?? '', true), dealType = value.dealType ?? 0, storeType = value.storeType ?? 2, priceType = value.priceType ?? 0;
  if (![0, 1, 2].includes(dealType) || ![1, 2].includes(storeType) || ![0, 1, 2, 3].includes(priceType)) fail('交易类型、身份或价格方式无效');
  if (dealType === 2 && storeType !== 2) fail('换机仅支持个人身份');
  const price = secondhandText(value.price ?? '', 32);
  if (price && !/^\d+(?:\.\d+)?$/.test(price)) fail('商品价格必须是非负金额');
  const link = secondhandLink(value.link ?? '', dealType !== 1);
  const configuration = value.configuration ?? { type: 'none' };
  if (!secondhandObject(configuration) || !['none', 'preset', 'custom', ...(editing ? ['preserve'] : [])].includes(configuration.type)) fail('闲置配置无效');
  const configFields = configuration.type === 'preset' ? ['type', 'id'] : configuration.type === 'custom' ? ['type', 'selections'] : ['type'];
  if (Object.keys(configuration).some(key => !configFields.includes(key))) fail('闲置配置包含未知字段');
  if (configuration.type === 'preset') { secondhandId(configuration.id); if (!productId) fail('请选择对应型号后选择配置'); }
  if (configuration.type === 'custom' && (!secondhandObject(configuration.selections) || !Object.keys(configuration.selections).length)) fail('请填写商品配置');
  if (categoryId === '104' && !['none', 'preserve'].includes(configuration.type)) fail('此品类不使用配置选择');
  const rawLocation = value.location ?? {};
  if (!secondhandObject(rawLocation) || Object.keys(rawLocation).some(key => !['name', 'city', 'country', 'province', 'cityCode', 'latitude', 'longitude'].includes(key))) fail('所在地参数无效');
  const location = Object.fromEntries(['name', 'city', 'country', 'province', 'cityCode'].map(key => [key, secondhandText(rawLocation[key] ?? '', 200)]));
  location.latitude = rawLocation.latitude ?? 0; location.longitude = rawLocation.longitude ?? 0;
  if (!Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) fail('所在地坐标无效');
  const origin = value.origin ?? 'general', visibility = value.visibility ?? 'public';
  if (!['general', 'product'].includes(origin) || origin === 'product' && !productId || !['public', 'self'].includes(visibility)) fail('发布位置或可见范围无效');
  return { title, message, pic, categoryId, productId, dealType, storeType, price: priceType === 3 ? '' : price, priceType, link, configuration: structuredClone(configuration), location, origin, visibility };
}
