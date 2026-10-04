export type UserPublicTab = { id: string; title: string };
export const USER_PUBLIC_TABS: readonly UserPublicTab[];
export function visibleUserTabs(data?: unknown): UserPublicTab[];
export function userEntityTarget(row: unknown): Record<string, any> | null;
