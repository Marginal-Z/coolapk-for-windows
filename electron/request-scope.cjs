// A request keeps the account it started with, even if the active account changes.
class AccountScope {
  constructor() { this.epoch = 0; }
  changed() { this.epoch++; }
  capture(client) {
    return { epoch: this.epoch, client: new client.constructor({ deviceCode: client.deviceCode, fetchImpl: client.fetch, cookie: client.cookie, identity: client.identity ? { ...client.identity } : null }) };
  }
  assert(context) {
    if (context.epoch !== this.epoch) { const error = new Error('账号已切换，请重新发起请求'); error.code = 'ACCOUNT_CHANGED'; throw error; }
  }
}
module.exports = { AccountScope };
