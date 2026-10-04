import type { SecondhandPublishInput } from './secondhand-publishing-models.mjs';
export type SecondhandConfigGroup = { key: string; label: string; single: boolean; required: boolean; options: string[]; allowOther: boolean };
export const SECONDHAND_PUBLISHING_OPERATIONS: readonly string[];
export function parseSecondhandConfig(result: { data: unknown }): SecondhandConfigGroup[];
export function serializeSecondhandSelections(groups: SecondhandConfigGroup[], selections: Record<string, { value: string; other?: boolean }[]>): string;
export function secondhandEditableFields(feed: any): Required<SecondhandPublishInput>;
export function dispatchSecondhandPublishing(client: any, operation: string, args?: any): Promise<any>;
