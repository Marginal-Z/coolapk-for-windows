export const CREATION_LIMITS: Readonly<{ questionTitle: number; pollTitle: number; ordinaryBody: number; pollOptions: number; pkOption: number; pollOption: number; pictures: number }>;
export const POLL_DURATIONS: readonly number[];
export type CreationPublishOptions = { targetType?: '' | 'tag' | 'product_phone'; targetId?: string; originalType?: number; visibleStatus?: number; extraUrl?: string; dyhId?: string };
export type QuestionCreation = { title: string; message?: string; pic?: string; publishOptions?: CreationPublishOptions };
export type PollCreation = { title: string; message?: string; pollType?: number; options: string[]; endTime?: number; maxSelectNum?: number; colors?: string[]; publishOptions?: CreationPublishOptions };
export function normalizeQuestionTitle(value: string): string;
export function prepareQuestion(args: QuestionCreation): Required<QuestionCreation>;
export function preparePoll(args: PollCreation): Required<Omit<PollCreation, 'colors'>> & { colors?: string[] };
