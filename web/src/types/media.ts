import type { MediaSource } from "@/types/media-reference";

export type ReferenceVideo = {
    id: string;
    name: string;
    type: string;
    url: string;
    referenceUrl?: string;
    storageKey?: string;
    bytes?: number;
    width?: number;
    height?: number;
    durationMs?: number;
    mediaSource?: MediaSource;
};

export type ReferenceAudio = {
    id: string;
    name: string;
    type: string;
    url: string;
    referenceUrl?: string;
    storageKey?: string;
    durationMs?: number;
    bytes?: number;
};
