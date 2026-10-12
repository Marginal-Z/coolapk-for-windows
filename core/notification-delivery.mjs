import { exactNotificationTotal } from './notifications.mjs';

// Windows has no Coolapk push transport. While the client is running, poll the
// APK-confirmed counters and emit a content-free native notification on growth.
export class NotificationDelivery {
  constructor({ getClient, capture, assertCurrent, notify, intervalMs = 60_000, schedule = setTimeout, cancel = clearTimeout }) {
    if (![getClient, capture, assertCurrent, notify, schedule, cancel].every(value => typeof value === 'function')) throw new TypeError('通知投递依赖无效');
    if (!Number.isFinite(intervalMs) || intervalMs < 10_000) throw new TypeError('通知轮询间隔无效');
    this.getClient = getClient;
    this.capture = capture;
    this.assertCurrent = assertCurrent;
    this.notify = notify;
    this.intervalMs = intervalMs;
    this.schedule = schedule;
    this.cancel = cancel;
    this.enabled = false;
    this.ignoreLikes = false;
    this.lastTotal = null;
    this.generation = 0;
    this.timer = null;
  }

  configure({ enabled, ignoreLikes }) {
    if (typeof enabled !== 'boolean' || typeof ignoreLikes !== 'boolean') throw new TypeError('桌面通知设置无效');
    this.#reset();
    this.enabled = enabled;
    this.ignoreLikes = ignoreLikes;
    if (enabled) void this.#poll(this.generation);
    return { enabled: this.enabled };
  }

  accountChanged() {
    this.enabled = false;
    this.#reset();
  }

  close() {
    this.enabled = false;
    this.#reset();
  }

  #reset() {
    this.generation++;
    this.lastTotal = null;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }

  #scheduleNext(generation) {
    if (!this.enabled || generation !== this.generation) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.#poll(generation);
    }, this.intervalMs);
    this.timer?.unref?.();
  }

  async #poll(generation) {
    if (!this.enabled || generation !== this.generation) return;
    const client = this.getClient();
    if (!client?.identity?.uid) {
      this.#scheduleNext(generation);
      return;
    }
    try {
      const context = this.capture(client);
      const response = await client.dispatch('notificationCount');
      if (!this.enabled || generation !== this.generation) return;
      this.assertCurrent(context);
      const total = exactNotificationTotal(response, { ignoreLikes: this.ignoreLikes });
      if (total !== null) {
        if (this.lastTotal !== null && total > this.lastTotal) {
          try { this.notify(); } catch { /* A disabled Windows notification service must not stop polling. */ }
        }
        this.lastTotal = total;
      }
    } catch {
      // Polling is opportunistic; account changes, verification and network
      // failures leave the in-app notification center available as usual.
    }
    this.#scheduleNext(generation);
  }
}
