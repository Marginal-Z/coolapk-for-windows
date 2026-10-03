type ChatRecord = Record<string, any>;
const uidOf = (value: unknown) => { const uid = String(value ?? '').trim(); return /^[1-9]\d*$/.test(uid) ? uid : ''; };

export function sessionPartnerUid(session: ChatRecord, currentUid?: string): string {
  const mine = uidOf(currentUid);
  const partner = uidOf(session.messageUid);
  if (partner && partner !== mine) return partner;
  const sender = ['fromuid', 'fromUid', 'senderUid', 'sender_uid', 'messageFromUid', 'message_from_uid', 'lastMessageFromUid', 'last_message_from_uid'].map(key => uidOf(session[key])).find(Boolean) || '';
  const recipient = uidOf(session.uid ?? session.toUid ?? session.to_uid);
  if (mine && sender === mine && recipient && recipient !== mine) return recipient;
  if (mine && recipient === mine && sender && sender !== mine) return sender;
  return [sender, recipient, uidOf(session.userInfo?.uid)].find(uid => uid && uid !== mine) || '';
}

export function sessionKey(session: ChatRecord): string {
  const key = String(session.ukey || session.id || '').trim();
  return key && key.length <= 160 && !/[\u0000-\u001f\u007f]/.test(key) && !key.startsWith('new-') ? key : '';
}

export function matchingSessionKey(items: ChatRecord[], partnerUid: string, currentUid?: string): string {
  const match = items.find(item => sessionPartnerUid(item, currentUid) === partnerUid && sessionKey(item));
  return match ? sessionKey(match) : '';
}
