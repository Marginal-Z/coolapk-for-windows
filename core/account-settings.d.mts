import type { AccountSettingValues, AccountSettingsPatch } from './account-settings-models.mjs';
export type { AccountSettingsPatch } from './account-settings-models.mjs';
export type AccountSettingsData = { values: AccountSettingValues; present: string[]; guardExpiresAt: number | null; replyLocked: boolean };
export const ACCOUNT_SETTINGS_OPERATIONS: readonly string[];
export function accountSettingsAccountGuard(client: any): () => void;
export function parseAccountSettings(data: unknown): AccountSettingsData;
export function dispatchAccountSettings(client: any, operation: string, args?: { patch?: AccountSettingsPatch }): Promise<{ data: AccountSettingsData } | undefined>;
