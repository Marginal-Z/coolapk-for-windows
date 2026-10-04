export interface MaterialReadabilityInput { theme?: string; opacity?: number; surface?: string; body?: string; muted?: string; accent?: string; header?: string; headerText?: string; }
export interface MaterialReadability { floor: number; opacity: number; surface: string; body: string; muted: string; accent: string; accentHover: string; accentOn: string; header: string; headerOpacity: number; headerText: string; }
export function compositeMaterial(surface: string, backdrop: string, opacity: number): string;
export function materialReadability(value?: MaterialReadabilityInput): MaterialReadability;
