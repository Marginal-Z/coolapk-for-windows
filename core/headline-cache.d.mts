import type { Result } from '../src/types';

export const HEADLINE_CACHE_PREFIX: string;
export const HEADLINE_CACHE_MAX_BYTES: number;
export function loadHeadlineCache(storage: Storage | null | undefined, namespace: string): Result | null;
export function saveHeadlineCache(storage: Storage | null | undefined, namespace: string, result: Result, now?: number): boolean;
export function clearHeadlineCache(storage: Storage | null | undefined, namespace: string): boolean;
