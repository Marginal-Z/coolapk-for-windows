export function historyStorageKey(namespace?: string): string;
export function readLocalHistory(storage: Pick<Storage, 'getItem'>, namespace: string): Record<string, any>[];
export function saveLocalHistory(storage: Pick<Storage, 'setItem'>, namespace: string, items: Record<string, any>[]): void;
export function clearLocalHistory(storage: Pick<Storage, 'removeItem'>, namespace: string): void;
