export type SurfaceEntity = Record<string, any>;
export type SurfaceSection = { item: SurfaceEntity; children?: SurfaceSection[] };
export function surfaceItemKey(item: unknown): string;
export function mergeSurfaceItems(previous?: unknown, next?: unknown, depth?: number): SurfaceEntity[] | undefined;
export function surfaceLeafCount(rows: unknown, depth?: number): number;
export function homeHeaderItems(rows: unknown): SurfaceEntity[];
export function homeSurfaceSections(rows: unknown, options?: { visibleFeed?: (feed: SurfaceEntity) => boolean }, depth?: number, seen?: Set<unknown>): SurfaceSection[];
