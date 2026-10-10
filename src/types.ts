import type { UpdateState } from './SoftwareUpdate';
import type { TeenagerSnapshot } from '../core/teenager.mjs';
export type Entity = Record<string, any>;
export type Result = { data?: any; firstItem?: string; lastItem?: string; rawCount?: number; [key: string]: any };
export type Account = { uid: string; username: string; userAvatar: string };
export type AccountState = { accounts: Account[]; current: Account | null; warning?: string };
export type ReportTarget = { type: 'feed' | 'article' | 'feed_reply' | 'user'; id: string } | { type: 'apk'; packageName: string };
export type Reply<T> = { ok: true; data: T; metadataOnly?: boolean } | { ok: false; error: { message: string; code: string; verificationId?: string } };
export type BackgroundState = { available: boolean; revision: string; url: string; width: number; height: number; name: string; bytes: number; cancelled?: boolean };
export type Page = { kind: string; title: string; id?: string; uid?: string; tag?: string; url?: string; ukey?: string; type?: string; accountEntry?: number };
export type ImageViewerPayload = { images: string[]; index: number; items?: { source: string; cover: string; live: boolean; video?: string }[]; contextId?: string; contextType?: 'feed' | 'reply' | 'article' | 'message'; namespace?: string };
declare global {
  interface Window {
    coolapkImageViewer?: { state: () => Promise<Reply<ImageViewerPayload>>; close: () => Promise<Reply<Entity>> };
    coolapk?: {
      call: (operation: string, args?: Entity) => Promise<Reply<Result>>;
      accounts: () => Promise<Reply<AccountState>>;
      login: () => Promise<Reply<any>>;
      importCookie: (cookie: string) => Promise<Reply<AccountState>>;
      verify: (verificationId: string) => Promise<Reply<any>>;
      selectAccount: (uid: string) => Promise<Reply<AccountState>>;
      removeAccount: (uid: string) => Promise<Reply<AccountState>>;
      openExternal: (url: string) => Promise<Reply<void>>;
      openAccountPage: (page: 'username' | 'security') => Promise<Reply<Entity>>;
      report: (target: ReportTarget) => Promise<Reply<Entity>>;
      desktop: (operation: 'info' | 'display' | 'clearCache', args?: Entity) => Promise<Reply<Entity>>;
      teenager: (operation: 'info' | 'enable' | 'disable' | 'changePin' | 'content' | 'detail', args?: Entity) => Promise<Reply<TeenagerSnapshot | Result>>;
      onTeenager: (callback: (snapshot: TeenagerSnapshot) => void) => () => void;
      updates: (operation: 'info' | 'check' | 'download' | 'cancel' | 'install') => Promise<Reply<UpdateState>>;
      onUpdates: (callback: (snapshot: UpdateState) => void) => () => void;
      saveImage: (args: { url: string; name?: string }) => Promise<Reply<Entity>>;
      openImageViewer?: (args: ImageViewerPayload) => Promise<Reply<Entity>>;
      shareImageData: (args: { url: string }) => Promise<Reply<string>>;
      saveExport: (args: { kind: 'markdown' | 'json' | 'png'; name: string; content: string | Uint8Array }) => Promise<Reply<Entity>>;
      background: (operation: 'state' | 'choose' | 'remove') => Promise<Reply<BackgroundState>>;
      downloads: (operation: string, args?: Entity) => Promise<Reply<any>>;
      onDownloads: (callback: (snapshot: any) => void) => () => void;
      onAccount: (callback: (result: Reply<AccountState>) => void) => () => void;
      onCommand: (callback: (command: string) => void) => () => void;
    };
  }
}
