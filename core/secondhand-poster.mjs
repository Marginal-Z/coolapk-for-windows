// Mirror the confirmed read/write aliases in secondhand-publishing.mjs.
// Unknown transaction modes are omitted instead of presented as sale prices.
export function secondhandPosterPrice(entity = {}) {
  const nested = entity.ershou_info ?? entity.secondHandInfo;
  const info = nested && typeof nested === 'object' && !Array.isArray(nested) ? nested : null;
  const rawPrice = info ? info.product_price ?? info.price : entity.ershou_price;
  const rawDeal = info ? info.deal_type ?? info.secondHandDealType : entity.ershou_deal_type;
  const rawMode = info ? info.exchange_price_type ?? info.exchangePriceType : entity.exchange_type;
  const face = info ? info.is_face_deal ?? info.secondHandFaceDeal : entity.face_deal;
  const token = value => (typeof value === 'number' && Number.isInteger(value) || typeof value === 'string' && /^\d$/.test(value)) ? Number(value) : undefined;
  const deal = token(rawDeal), mode = token(rawMode);
  if (![0, 1, 2].includes(deal) || mode != null && ![0, 1, 2, 3].includes(mode)) return '';
  if (token(face) === 1 || mode === 3) return '价格面议';
  const price = typeof rawPrice === 'string' || typeof rawPrice === 'number' ? String(rawPrice) : '';
  if (!/^\d+(?:\.\d+)?$/.test(price) || price.length > 32) return deal === 2 ? '换机' : '';
  if (deal === 2) return mode === 1 ? `卖家加钱 ¥${price}` : mode === 2 ? `买家加钱 ¥${price}` : '换机';
  if (mode != null && mode !== 0) return '';
  return deal === 1 ? `收购 ¥${price}` : `¥${price}`;
}
