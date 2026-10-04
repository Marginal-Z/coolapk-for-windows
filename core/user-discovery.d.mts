export type UserPublicTab = { id: string; title: string };
export const USER_DISCOVERY_OPERATIONS: readonly string[];
export const USER_PUBLIC_TABS: readonly UserPublicTab[];
export function visibleUserTabs(data?: unknown): UserPublicTab[];
export function userEntityTarget(row: unknown): Record<string, any> | null;
export function dispatchUserDiscovery(client: any, operation: string, args?: Record<string, any>): Promise<any>;
