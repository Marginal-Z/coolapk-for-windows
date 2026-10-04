export function accountStatistic(value: unknown): number | null;
export function accountOverviewSummary(data: unknown, uid: string): Record<string, number | null>;
export function accountCardTarget(row: any): any;
export function accountOverviewCards(value: unknown): { cards: any[]; invalid: boolean };
