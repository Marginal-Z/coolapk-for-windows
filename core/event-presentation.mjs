const field = (event, camel, snake) => event?.[camel] ?? event?.[snake];
const number = value => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
};
const modelInt = value => value == null ? 0 : number(value);

/** Mirrors the event action state machine in Coolapk Android 16.6.4. */
export function eventPresentation(event) {
  const stage = modelInt(field(event, 'stageStatus', 'stage_status'));
  const joined = modelInt(field(event, 'isJoinStatus', 'is_join_status'));
  const isPrize = modelInt(field(event, 'isPrize', 'is_get_prize'));
  const prizeUser = String(field(event, 'prizeUser', 'prize_user') ?? '').trim();
  const rawRegNum = String(field(event, 'regNum', 'reg_num') ?? '').trim();
  const registrationCount = rawRegNum
    ? /^\d+$/.test(rawRegNum) && Number(rawRegNum) > 0 ? `已有 ${Number(rawRegNum)} 人报名` : '还没人报名'
    : '';

  if (stage === 0) return { stageLabel: '报名未开始', statusLabel: '报名未开始', action: null, registrationCount };
  if (stage === 1) {
    return joined === 1
      ? { stageLabel: '报名中', statusLabel: '报名成功，等待审核中', action: null, registrationCount }
      : joined === 0
        ? { stageLabel: '报名中', statusLabel: '立即报名', action: 'registration', registrationCount }
        : { stageLabel: '报名中', statusLabel: '报名状态暂不可用', action: null, registrationCount };
  }
  if (stage === 2) {
    if (!prizeUser) return { stageLabel: '活动进行中', statusLabel: '暂未公布众测名单', action: null, registrationCount };
    if (isPrize === 1) return { stageLabel: '活动进行中', statusLabel: '恭喜您被选中，查看众测名单', action: 'prize-list', registrationCount };
    if (joined === 1 && isPrize === 0) return { stageLabel: '活动进行中', statusLabel: '抱歉您未被选中，查看众测名单', action: 'prize-list', registrationCount };
    return { stageLabel: '活动进行中', statusLabel: '查看众测名单', action: 'prize-list', registrationCount };
  }
  if (stage === 3) return { stageLabel: '活动已结束', statusLabel: '活动已结束', action: null, registrationCount };
  return { stageLabel: '活动状态暂不可用', statusLabel: '活动状态暂不可用', action: null, registrationCount: '' };
}
