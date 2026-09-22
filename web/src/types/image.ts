import type { MediaSource } from "@/types/media-reference";

export type ReferenceImage = {
    id: string;
    name: string;
    type: string;
    dataUrl: string;
    url?: string;
    urlExpiresAt?: number;
    arkAssetSource?: string;
    storageKey?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mediaSource?: MediaSource;
};

export type GeneratedImageResult = Pick<ReferenceImage, "id" | "dataUrl" | "url" | "urlExpiresAt" | "mediaSource">;
