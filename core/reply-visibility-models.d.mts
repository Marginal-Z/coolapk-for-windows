export type ReplyVisibilityAction = 'hide' | 'resume';
export type ReplyVisibilityPermission = { visible: boolean; enabled: boolean; hidden: boolean; remaining: number | null; action: ReplyVisibilityAction | null; reason: string };
export function replyVisibilityPermission(reply: unknown, context?: { accountUid?: unknown; feedId?: unknown; feedAuthorUid?: unknown }): ReplyVisibilityPermission;
export function replyVisibilityMatches(reply: Record<string, any> | undefined, action: ReplyVisibilityAction): boolean;
