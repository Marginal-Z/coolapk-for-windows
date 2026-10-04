export type ReportTarget = { type: 'feed' | 'article' | 'feed_reply' | 'user'; id: string } | { type: 'apk'; packageName: string };
export const REPORT_TYPES: readonly ReportTarget['type'][];
export function buildReportRoute(target: ReportTarget): string;
export function allowedReportNavigation(value: string): boolean;
export class ReportWindowManager {
  constructor(options: { createWindow(options: any): any; createSession(partition: string): any; assertCurrent(context: any): void; parent(): any; icon?: string; onClosed?(): void; makeId?(): string });
  windows: Set<any>;
  closeAll(): void;
  open(target: ReportTarget, context: any): Promise<{ opened: true }>;
}
