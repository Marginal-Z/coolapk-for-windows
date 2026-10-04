export type ContentRoute = { kind: string; title?: string; id?: string; uid?: string; tag?: string; type?: string; url?: string; replyId?: string; inputOnly?: boolean };
export function coolapkRoute(value: unknown, depth?: number): ContentRoute | null;
export function deepLinkWebUrl(value: unknown): string;
