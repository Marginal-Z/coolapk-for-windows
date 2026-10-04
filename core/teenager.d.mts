export type TeenagerSnapshot = Readonly<{
  enabled: boolean; blocked: boolean; reason: 'night' | 'daily_limit' | 'state_error' | null;
  usedMilliseconds: number; remainingMilliseconds: number; limitMilliseconds: number; day: string; lockedUntil: number | null;
}>;
export const TEENAGER_LIMIT_MILLISECONDS: number;
export class TeenagerError extends Error { code: string; constructor(message: string, code: string); }
export class TeenagerStore {
  constructor(options: { filePath: string; encrypt?: (text: string) => Buffer; decrypt?: (data: Buffer) => string; now?: () => number });
  info(): TeenagerSnapshot;
  tick(): TeenagerSnapshot;
  setActive(active: boolean): TeenagerSnapshot;
  enable(pin: string, confirmation: string): Promise<TeenagerSnapshot>;
  disable(pin: string): Promise<TeenagerSnapshot>;
  changePin(oldPin: string, newPin: string, confirmation: string): Promise<TeenagerSnapshot>;
}
