import type { QuestionCreation, PollCreation } from './creation-models.mjs';
export const CREATION_OPERATIONS: readonly string[];
export function dispatchCreation(client: any, operation: 'questionCreate' | 'pollCreate' | 'relatedQuestions' | string, args?: QuestionCreation | PollCreation | { title: string }): Promise<any>;
