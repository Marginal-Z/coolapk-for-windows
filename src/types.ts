export type Entity = Record<string, any>;
export type Result = { data?: any; firstItem?: string; lastItem?: string; rawCount?: number; [key: string]: any };
export type Account = { uid: string; username: string; userAvatar: string };
export type AccountState = { accounts: Account[]; current: Account | null; warning?: string };
export type Reply<T> = { ok: true; data: T; metadataOnly?: boolean } | { ok: false; error: { message: string; code: string; verificationId?: string } };
export type Page = { kind: string; title: string; id?: string; uid?: string; tag?: string; url?: string; ukey?: string; type?: string; accountEntry?: number };
declare global {
  interface Window {
    coolapk?: {
      call: (operation: string, args?: Entity) => Promise<Reply<Result>>;
      accounts: () => Promise<Reply<AccountState>>;
      login: () => Promise<Reply<any>>;
      importCookie: (cookie: string) => Promise<Reply<AccountState>>;
      verify: (verificationId: string) => Promise<Reply<any>>;
      selectAccount: (uid: string) => Promise<Reply<AccountState>>;
      removeAccount: (uid: string) => Promise<Reply<AccountState>>;
      openExternal: (url: string) => Promise<Reply<void>>;
      phone: (operation: string, args?: Entity) => Promise<Reply<Entity>>;
      openAccountPage: (page: 'username' | 'security') => Promise<Reply<Entity>>;
      desktop: (operation: 'info' | 'display' | 'clearCache', args?: Entity) => Promise<Reply<Entity>>;
      saveImage: (args: { url: string; name?: string }) => Promise<Reply<Entity>>;
      shareImageData: (args: { url: string }) => Promise<Reply<string>>;
      saveExport: (args: { kind: 'markdown' | 'json' | 'png'; name: string; content: string | Uint8Array }) => Promise<Reply<Entity>>;
      downloads: (operation: string, args?: Entity) => Promise<Reply<any>>;
      onDownloads: (callback: (snapshot: any) => void) => () => void;
      onAccount: (callback: (result: Reply<AccountState>) => void) => () => void;
      onCommand: (callback: (command: string) => void) => () => void;
    };
  }
}
