export type ShortcutKey = 'following' | 'collections' | 'rating' | 'night' | 'article' | 'reply' | 'plugins' | 'drafts' | 'digital' | 'lists' | 'likes' | 'coolpic' | 'qa' | 'goods' | 'goodsRank' | 'albums' | 'blacklist' | 'blocks' | 'backups' | 'downloads' | 'kankan' | 'settings';
export const DEFAULT_SHORTCUTS: readonly ShortcutKey[];
export const SHORTCUT_TITLES: Readonly<Record<ShortcutKey, string>>;
export function normalizeShortcuts(value: unknown): ShortcutKey[];
export function shortcutStorageKey(namespace: string): string;
export function loadShortcuts(storage: Pick<Storage, 'getItem'>, namespace: string): ShortcutKey[];
export function saveShortcuts(storage: Pick<Storage, 'setItem'>, namespace: string, value: unknown): ShortcutKey[];
export function moveShortcut(value: unknown, key: ShortcutKey, target: number): ShortcutKey[];
