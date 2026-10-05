export interface GlassGeometry { width: number; height: number; radius: number; rim: number; rasterWidth: number; rasterHeight: number; scale: number; }
export function glassGeometry(width: number, height: number, radius?: number): GlassGeometry;
export function glassOffset(geometry: GlassGeometry, x: number, y: number): { x: number; y: number };
export function glassPixels(geometry: GlassGeometry): Uint8ClampedArray;
