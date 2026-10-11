export type LivePhotoHeaderInfo = {
  container: string;
  brand: string | null;
  codecs: string[];
};

export declare function inspectLivePhotoHeader(bytes: Uint8Array): LivePhotoHeaderInfo;
