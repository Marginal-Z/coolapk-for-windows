import test from 'node:test';
import assert from 'node:assert/strict';
import { secondhandPosterPrice } from '../core/secondhand-poster.mjs';

test('real nested sale and acquisition fields preserve the transaction price', () => {
  assert.equal(secondhandPosterPrice({ ershou_info: { product_price: '1999.50', deal_type: 0, exchange_price_type: 0 } }), '¥1999.50');
  assert.equal(secondhandPosterPrice({ secondHandInfo: { price: '1000', secondHandDealType: '1', exchangePriceType: '0' } }), '收购 ¥1000');
  assert.equal(secondhandPosterPrice({ ershou_info: { product_price: 0, deal_type: 0 } }), '¥0');
});
test('face-to-face negotiation and exchange adjustments never become ordinary sale prices', () => {
  assert.equal(secondhandPosterPrice({ ershou_info: { product_price: '200', deal_type: 2, exchange_price_type: 1 } }), '卖家加钱 ¥200');
  assert.equal(secondhandPosterPrice({ ershou_info: { product_price: '200', deal_type: 2, exchange_price_type: 2 } }), '买家加钱 ¥200');
  assert.equal(secondhandPosterPrice({ ershou_info: { product_price: '200', deal_type: 2, exchange_price_type: 0 } }), '换机');
  assert.equal(secondhandPosterPrice({ ershou_info: { product_price: '200', deal_type: 0, is_face_deal: '1' } }), '价格面议');
  assert.equal(secondhandPosterPrice({ ershou_price: '200', ershou_deal_type: '0', exchange_type: 3 }), '价格面议');
  assert.equal(secondhandPosterPrice({ ershou_price: '200', ershou_deal_type: 2, exchange_type: 1, face_deal: 0 }), '卖家加钱 ¥200');
});
test('unconfirmed generic prices, invalid amounts and unknown deal modes do not invent prices', () => {
  for (const entity of [{price: '100'}, {ershou_price: '100'}, {ershou_info: {product_price: '100', deal_type: 9}}, {ershou_info: {product_price: 'Infinity', deal_type: 0}}, {ershou_info: {product_price: '<script>1</script>', deal_type: 0}}, {ershou_info: {product_price: '100', deal_type: 0, exchange_price_type: 9}}]) assert.equal(secondhandPosterPrice(entity), '');
});
