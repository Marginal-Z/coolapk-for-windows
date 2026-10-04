const id = value => /^\d{1,20}$/.test(String(value ?? '')) ? String(value) : '';
const clean = (value, limit) => typeof value === 'string' && value.trim() && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : '';

export function composeUsers(items) {
  if (!Array.isArray(items)) return [];
  const users = items.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const info = item.userInfo || item.fUserInfo || item;
    const uid = id(info.uid || item.fuid || item.uid), username = clean(info.username || info.displayUserName || item.fusername || item.username, 100);
    if (!uid || !username || /[@<>]/.test(username)) return [];
    return [{ uid, username, userAvatar: clean(info.userAvatar || info.avatar || item.fUserAvatar || item.userAvatar, 4096) }];
  });
  return [...new Map(users.map(user => [user.uid, user])).values()];
}

export function composeTopics(items) {
  if (!Array.isArray(items)) return [];
  return [...new Map(items.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const topicId = id(item.id), title = clean(String(item.tag || item.title || item.entityTitle || '').replace(/^#|#$/g, ''), 200);
    if (!topicId || !title || /[#<>]/.test(title) || item.entityType && !['topic', 'tag', 'feedTopic'].includes(item.entityType)) return [];
    return [[topicId, { id: topicId, title }]];
  })).values()];
}

// Textarea selection offsets are UTF-16 indices. Keep surrogate pairs whole,
// including an externally supplied selection that lands inside an emoji.
export function composeSelection(message, start = message.length, end = start) {
  const index = value => Math.max(0, Math.min(message.length, Number.isFinite(value) ? Math.trunc(value) : message.length));
  let from = index(Math.min(start, end)), to = index(Math.max(start, end));
  const split = offset => offset > 0 && offset < message.length && /[\uD800-\uDBFF]/.test(message[offset - 1]) && /[\uDC00-\uDFFF]/.test(message[offset]);
  if (from === to) { if (split(from)) from = to = from - 1; }
  else { if (split(from)) from--; if (split(to)) to++; }
  return { start: from, end: to };
}

export function insertComposeText(message, selection, kind, records, max = 1000) {
  if (typeof message !== 'string' || !Array.isArray(records) || !['mention', 'topic'].includes(kind)) throw new Error('插入内容无效');
  const values = kind === 'mention' ? composeUsers(records) : composeTopics(records);
  if (!values.length || kind === 'topic' && values.length !== 1 || values.length !== new Set(records.map(value => kind === 'mention' ? String(value?.uid) : String(value?.id))).size) throw new Error('请选择有效的酷友或话题');
  const { start, end } = composeSelection(message, selection?.start, selection?.end);
  const insertion = kind === 'mention' ? values.map(user => `@${user.username} `).join('') : `#${values[0].title}# `;
  const next = message.slice(0, start) + insertion + message.slice(end);
  if ([...next].length > max) throw new Error(`插入后正文不能超过 ${max} 字`);
  return { message: next, start: start + insertion.length, end: start + insertion.length };
}
