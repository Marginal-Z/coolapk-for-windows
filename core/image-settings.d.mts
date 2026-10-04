export type ImageWatermarkPosition = '0' | '5' | '7' | '8' | '9';
export type ImageWatermarkPatch = { position?: ImageWatermarkPosition; iconType?: '0' | '1'; coolPictures?: boolean; hdr?: boolean };
export type ImageWatermarkSettings = { enabled: boolean; position: ImageWatermarkPosition; iconType: '0' | '1'; coolPictures: boolean; hdr: boolean; present: string[] };
export const IMAGE_SETTINGS_OPERATIONS: readonly ['imageWatermarkSettings', 'imageWatermarkSettingsUpdate'];
export const WATERMARK_POSITIONS: readonly ['5', '7', '8', '9'];
export function parseImageWatermarkSettings(data: unknown): ImageWatermarkSettings;
export function imageWatermarkPatch(patch: unknown): Record<string, string>;
export function imageSettingsAccountGuard(client: any): () => void;
export function dispatchImageSettings(client: any, operation: string, args?: unknown): Promise<{ data: ImageWatermarkSettings } | undefined>;
