const inputError = message => Object.assign(new Error(message), { code: 'INPUT' });
const restriction = message => Object.assign(new Error(message || '青少年模式下无法使用此功能'), { code: 'TEENAGER_RESTRICTED' });
class TeenagerAccess {
  constructor({ store, getClient, capture, assertCurrent, beforeDisable = () => {}, onTransition = () => {}, onSnapshot = () => {} }) {
    Object.assign(this, { store, getClient, capture, assertCurrent, beforeDisable, onTransition, onSnapshot });
    this.feedIds = new Set(); this.imageUrls = new Set(); this.epoch = 0; this.lastEnabled = store.info().enabled; this.busy = false;
  }
  observe(state) { if (state.enabled !== this.lastEnabled) this.transition(state); return state; }
  state() { return this.observe(this.store.info()); }
  tick() { const state = this.observe(this.store.tick()); this.onSnapshot(state); return state; }
  setActive(active) { const state = this.observe(this.store.setActive(active)); this.onSnapshot(state); return state; }
  assertChannel(channel) {
    if (this.state().enabled && channel !== 'coolapk:teenager') throw restriction();
  }
  assertContent(epoch) {
    const state = this.tick();
    if (epoch !== this.epoch || !state.enabled || state.blocked) throw restriction(state.reason === 'night' ? '22:00 至 06:00 无法使用酷安' : state.reason === 'daily_limit' ? '今天已达到40分钟使用限制' : '当前无法读取青少年内容');
  }
  assertImage(target, epoch = this.epoch) {
    const state = this.state();
    if (epoch !== this.epoch) throw restriction();
    if (state.enabled) { this.assertContent(epoch); if (!this.imageUrls.has(target)) throw restriction('只能读取精选内容中提供的图片'); }
    return epoch;
  }
  collectImages(item) {
    const candidates = Array.isArray(item.picArr) ? item.picArr.map(value => typeof value === 'string' ? value : value?.url || value?.pic)
      : typeof item.pic === 'string' ? item.pic.split(',') : typeof item.message_cover === 'string' ? [item.message_cover] : [];
    for (const candidate of candidates) {
      try { const url = new URL(candidate); if (url.protocol === 'https:' && !url.username && !url.password && !url.port && ['image.coolapk.com', 'static.coolapk.com', 'cdn.coolapk.com'].includes(url.hostname)) this.imageUrls.add(url.toString()); } catch {}
    }
  }
  transition(state) {
    this.epoch++; this.feedIds.clear(); this.imageUrls.clear(); this.lastEnabled = state.enabled;
    try { this.onTransition(state); } finally { this.onSnapshot(state); } return state;
  }
  async dispatch(operation, args = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw inputError('青少年模式参数无效');
    const fields = { info: [], enable: ['pin', 'confirmation'], disable: ['pin'], changePin: ['oldPin', 'newPin', 'confirmation'], content: ['page', 'firstItem', 'lastItem'], detail: ['id'] };
    if (!Object.hasOwn(fields, operation) || Object.keys(args).some(key => !fields[operation].includes(key))) throw inputError('青少年模式操作无效');
    if (operation === 'info') return this.tick();
    if (['enable', 'disable', 'changePin'].includes(operation)) {
      if (this.busy) throw inputError('模式设置正在处理，请稍候');
      this.busy = true;
      try {
        if (operation === 'enable') return this.transition(await this.store.enable(args.pin, args.confirmation));
        if (operation === 'disable') { if (this.state().enabled) await this.beforeDisable(); return this.transition(await this.store.disable(args.pin)); }
        const state = await this.store.changePin(args.oldPin, args.newPin, args.confirmation); this.onSnapshot(state); return state;
      } finally { this.busy = false; }
    }
    const epoch = this.epoch;
    this.assertContent(epoch);
    const context = this.capture(this.getClient());
    // Youth reads always use a guest snapshot, including when a stored desktop
    // account exists. Renderer cannot provide a path, cookie or page descriptor.
    context.client.cookie = ''; context.client.identity = null;
    let result;
    if (operation === 'content') {
      const page = args.page ?? 1;
      if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw inputError('青少年内容页码无效');
      const marker = value => { if (typeof value !== 'string' || !value || value.length > 120 || /[\x00-\x1f\x7f]/.test(value)) throw inputError('青少年分页标记无效'); return value; };
      result = await context.client.request('/v6/page/dataList', { url: 'V12_TEENAGER', page, ...(args.firstItem ? { firstItem: marker(args.firstItem) } : {}), ...(args.lastItem ? { lastItem: marker(args.lastItem) } : {}) });
      this.assertCurrent(context); this.assertContent(epoch);
      if (!Array.isArray(result.data)) throw Object.assign(new Error('精选内容返回格式异常，请重试'), { code: 'API_ERROR' });
      const collect = (rows, depth = 0) => { if (depth > 8) return; for (const row of rows.slice(0, 1000)) { if (!row || typeof row !== 'object') continue; if (row.entityType === 'feed' && /^[1-9]\d{0,19}$/.test(String(row.id))) { this.feedIds.add(String(row.id)); this.collectImages(row); } if (Array.isArray(row.entities)) collect(row.entities, depth + 1); } };
      collect(result.data);
      result = { ...result, page, hasMore: typeof result.hasMore === 'boolean' ? result.hasMore : result.data.length > 0 };
    } else {
      const id = String(args.id ?? '');
      if (!/^[1-9]\d{0,19}$/.test(id) || !this.feedIds.has(id)) throw restriction('只能打开青少年精选中提供的动态');
      result = await context.client.request('/v6/feed/detail', { id }, { method: 'POST', form: { trace: '' } });
      this.assertCurrent(context); this.assertContent(epoch);
      if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data) || String(result.data.id) !== id) throw Object.assign(new Error('精选动态返回格式异常'), { code: 'API_ERROR' });
      this.collectImages(result.data);
    }
    return result;
  }
}
module.exports = { TeenagerAccess };
