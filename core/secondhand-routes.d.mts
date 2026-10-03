export type SecondhandFilters = { brand: string; productId: string; cityId: string; ershouType: string; dataListType: string };
export type SecondhandRoute = { type: 'home'; filters?: never } | { type: 'list'; filters: SecondhandFilters };
export const SECONDHAND_HOME: string;
export const SECONDHAND_FILTER_KEYS: readonly string[];
export function secondhandFilters(value?: Partial<SecondhandFilters>): SecondhandFilters;
export function secondhandDescriptor(value?: Partial<SecondhandFilters>): string;
export function parseSecondhandRoute(value: unknown, depth?: number): SecondhandRoute | null;
export function secondhandEntityTarget(entity: Record<string, any>, brand?: string, forceModel?: boolean): SecondhandRoute | null;
