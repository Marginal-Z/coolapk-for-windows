export type ComposeUser = { uid: string; username: string; userAvatar?: string };
export type ComposeTopic = { id: string; title: string };
export function composeUsers(items: unknown): ComposeUser[];
export function composeTopics(items: unknown): ComposeTopic[];
export function composeSelection(message: string, start?: number, end?: number): { start: number; end: number };
export function insertComposeText(message: string, selection: { start: number; end: number }, kind: 'mention' | 'topic', records: unknown[], max?: number): { message: string; start: number; end: number };
