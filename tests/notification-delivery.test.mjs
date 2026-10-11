import test from 'node:test';
import assert from 'node:assert/strict';
import { NotificationDelivery } from '../core/notification-delivery.mjs';

const response = (notification, likes, messages) => ({ data: { notification_v18: notification, feedlike: likes, message: messages } });
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(responses, { uid = '1001', assertCurrent = () => {}, ignoreLikes = false } = {}) {
  const timers = [], calls = [], alerts = [];
  let currentUid = uid, index = 0;
  const client = {
    get identity() { return currentUid ? { uid: currentUid } : null; },
    dispatch: async operation => { calls.push(operation); const next = responses[index++]; if (next instanceof Error) throw next; return typeof next === 'function' ? next() : next; },
  };
  const delivery = new NotificationDelivery({
    getClient: () => client,
    capture: current => ({ uid: current.identity.uid }),
    assertCurrent,
    notify: () => alerts.push('generic'),
    intervalMs: 60_000,
    schedule: (callback, delay) => { const timer = { callback, delay, cancelled: false, fired: false }; timers.push(timer); return timer; },
    cancel: timer => { timer.cancelled = true; },
  });
  return {
    delivery, client, timers, calls, alerts,
    setUid: value => { currentUid = value; },
    configure: (enabled = true, likes = ignoreLikes) => delivery.configure({ enabled, ignoreLikes: likes }),
    async tick() { const timer = timers.find(item => !item.cancelled && !item.fired); assert.ok(timer, 'expected a scheduled poll'); timer.fired = true; timer.callback(); await settle(); },
  };
}

test('poll establishes a quiet baseline and emits one generic reminder only when the exact unread total rises', async () => {
  const testCase = fixture([response(2, 1, 0), response(3, 1, 0), response(3, 1, 0)]);
  testCase.configure(); await settle();
  assert.deepEqual(testCase.alerts, []);
  await testCase.tick(); assert.deepEqual(testCase.alerts, ['generic']);
  await testCase.tick(); assert.deepEqual(testCase.alerts, ['generic']);
  assert.deepEqual(testCase.calls, ['notificationCount', 'notificationCount', 'notificationCount']);
});

test('missing exact counters and request failures do not create reminders and are retried', async () => {
  const testCase = fixture([response(2, null, 0), new Error('verification required'), response(2, 1, 0), response(2, 2, 0)]);
  testCase.configure(); await settle();
  await testCase.tick(); await testCase.tick();
  assert.deepEqual(testCase.alerts, []);
  await testCase.tick(); assert.deepEqual(testCase.alerts, ['generic']);
  assert.equal(testCase.calls.length, 4);
});

test('the ignore-likes preference follows the native aggregate and never treats missing message count as zero', async () => {
  const testCase = fixture([response(2, null, 0), response(3, 5, 0), { data: { notification_v18: 4 } }, { data: { notification_v18: 3, message: 0 } }]);
  testCase.configure(true, true); await settle();
  await testCase.tick(); assert.deepEqual(testCase.alerts, ['generic']);
  await testCase.tick(); await testCase.tick();
  assert.deepEqual(testCase.alerts, ['generic']);
});

test('account changes invalidate an in-flight count and pause until the new account settings arrive', async () => {
  let finish;
  const testCase = fixture([() => new Promise(resolve => { finish = resolve; })]);
  testCase.configure(); await settle();
  testCase.delivery.accountChanged(); testCase.setUid('2002');
  finish(response(99, 99, 99)); await settle();
  assert.deepEqual(testCase.alerts, []);
  assert.equal(testCase.timers.filter(timer => !timer.cancelled).length, 0);
  testCase.configure(); await settle();
  assert.deepEqual(testCase.alerts, []);
});

test('account-scope rejection, disable and close cannot leak a stale notification or leave a timer active', async () => {
  const testCase = fixture([response(2, 0, 0), response(3, 0, 0)], { assertCurrent: () => { throw new Error('account changed'); } });
  testCase.configure(); await settle();
  assert.deepEqual(testCase.alerts, []);
  testCase.configure(false); assert.equal(testCase.delivery.enabled, false);
  assert.ok(testCase.timers.every(timer => timer.cancelled || timer.fired));
  testCase.configure(); await settle(); testCase.delivery.close();
  assert.equal(testCase.delivery.enabled, false);
  assert.ok(testCase.timers.every(timer => timer.cancelled || timer.fired));
});
