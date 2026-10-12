const accountPages = Object.freeze({
  username: 'https://account.coolapk.com/account/changeUsername',
  security: 'https://account.coolapk.com/account',
});

export function officialAccountPageRoute(page, uid) {
  if (Object.hasOwn(accountPages, page)) return accountPages[page];
  if (page === 'equipment') {
    const accountId = String(uid ?? '');
    if (!/^[1-9]\d{0,19}$/.test(accountId)) throw new Error('当前账号编号无效');
    return `https://m.coolapk.com/myDevice/${accountId}`;
  }
  throw new Error('账号页面无效');
}

export function isOfficialAccountPageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['account.coolapk.com', 'www.coolapk.com', 'm.coolapk.com'].includes(url.hostname);
  } catch { return false; }
}

export function officialAccountPageTitle(page) {
  return ({ username: '酷安 · 修改昵称', security: '酷安 · 账号安全', equipment: '酷安 · 我的装备' })[page] || '酷安';
}
