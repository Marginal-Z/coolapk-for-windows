// A request keeps the account it started with, even if the active account changes.
class AccountScope {
  constructor() { this.epoch = 0; }
  changed() { this.epoch++; }
  capture(client) {
    const context = { epoch: this.epoch, client: null };
    context.client = new client.constructor({ deviceCode: client.deviceCode, publicDeviceCode: client.publicDeviceCode, fetchImpl: (...args) => { this.assert(context); return client.fetch(...args); }, cookie: client.cookie, identity: client.identity ? { ...client.identity } : null });
    return context;
  }
  assert(context) {
    if (context.epoch !== this.epoch) { const error = new Error('账号已切换，请重新发起请求'); error.code = 'ACCOUNT_CHANGED'; throw error; }
  }
}
module.exports = { AccountScope };
