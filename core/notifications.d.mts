export type NotificationTab = { id: string; title: string; category: string; keys: string[] };
export const NOTIFICATION_TABS: readonly NotificationTab[];
export function notificationCounts(response: unknown, items?: unknown[]): { categories: Record<string, number | null>; total: number | null; message: number | null; community: number | null };
export function notificationModel(item: unknown, type?: string): {
  actor: { uid: string; username: string; avatar: string }; note: string; message: string; title: string;
  unread: number; time: number; feedId: string; replyId: string; link: string;
  entity: Record<string, any> | null; summary: string;
};
