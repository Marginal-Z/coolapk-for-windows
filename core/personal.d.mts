export const PERSONAL_OPERATIONS: readonly string[];
export const PERSONAL_CONTRACTS: readonly { readonly operation: string; readonly endpoint: string; readonly method: string; readonly descriptor?: string; readonly authenticated: boolean }[];
export function personalListResult(result: Record<string, any>): Record<string, any>;
export function dispatchPersonal(client: any, operation: string, args?: Record<string, any>): Promise<any>;
