export type MediaSource = {
    id: string;
    origin: "ark" | "other" | "upload";
    channelId?: string;
    model?: string;
    generatedAt?: number;
    originalUrl?: string;
    urlExpiresAt?: number;
};

export type MediaReferenceInput = {
    name?: string;
    dataUrl?: string;
    url?: string;
    referenceUrl?: string;
    urlExpiresAt?: number;
    storageKey?: string;
    mediaSource?: MediaSource;
    arkAssetSource?: string;
};
