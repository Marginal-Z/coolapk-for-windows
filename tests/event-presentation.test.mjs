import test from 'node:test';
import assert from 'node:assert/strict';
import { eventPresentation } from '../core/event-presentation.mjs';

test('event presentation follows the APK registration stages and only offers registration to an eligible event', () => {
  assert.deepEqual(eventPresentation({ stage_status: 0 }), { stageLabel: '报名未开始', statusLabel: '报名未开始', action: null, registrationCount: '' });
  assert.deepEqual(eventPresentation({ stageStatus: 1, isJoinStatus: 0, regNum: '12' }), { stageLabel: '报名中', statusLabel: '立即报名', action: 'registration', registrationCount: '已有 12 人报名' });
  assert.deepEqual(eventPresentation({ stage_status: 1, is_join_status: 1, reg_num: '0' }), { stageLabel: '报名中', statusLabel: '报名成功，等待审核中', action: null, registrationCount: '还没人报名' });
  assert.deepEqual(eventPresentation({ stage_status: 1 }), { stageLabel: '报名中', statusLabel: '立即报名', action: 'registration', registrationCount: '' });
  assert.deepEqual(eventPresentation({ stage_status: 3 }), { stageLabel: '活动已结束', statusLabel: '活动已结束', action: null, registrationCount: '' });
});

test('event presentation mirrors prize-list publication, winner state, and unknown-state safety', () => {
  assert.deepEqual(eventPresentation({ stage_status: 2 }), { stageLabel: '活动进行中', statusLabel: '暂未公布众测名单', action: null, registrationCount: '' });
  assert.equal(eventPresentation({ stageStatus: 2, prizeUser: '名单已公布', isPrize: 1 }).statusLabel, '恭喜您被选中，查看众测名单');
  assert.equal(eventPresentation({ stage_status: 2, prize_user: '已公布', is_get_prize: 0, is_join_status: 1 }).statusLabel, '抱歉您未被选中，查看众测名单');
  assert.equal(eventPresentation({ stage_status: 2, prize_user: '已公布', is_get_prize: 0, is_join_status: 0 }).action, 'prize-list');
  assert.deepEqual(eventPresentation({ stage_status: 9, reg_num: 'unknown' }), { stageLabel: '活动状态暂不可用', statusLabel: '活动状态暂不可用', action: null, registrationCount: '' });
});
