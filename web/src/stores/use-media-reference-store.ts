import localforage from "localforage";
import { create } from "zustand";
import { mediaReferenceKey } from "@/lib/media-reference";
import type { MediaReferenceInput } from "@/types/media-reference";

export type MediaReferenceProvider = "ark" | "kexiang";
export type MediaReferenceStatus = "processing" | "active" | "failed";
export type MediaReferenceRecord = {
    key: string;
    identity: string;
    scope: string;
    status: MediaReferenceStatus;
    provider: MediaReferenceProvider;
    kind: "image" | "video";
    source: string;
    publicUrl?: string;
    publicStorageKey?: string;
    publicUrlExpiresAt?: number;
    exemptUntil?: number;
    arkAssetId?: string;
    kexiangQueryId?: number;
    assetId?: string;
    error?: string;
    updatedAt: number;
};

type MediaReferenceStore = {
    records: Record<string, MediaReferenceRecord>;
    pending: Set<string>;
    progress: Record<string, string>;
    load: () => Promise<void>;
};

const storage = localforage.createInstance({ name: "infinite-canvas", storeName: "media_reference_records" });
const running = new Map<string, Promise<string>>();
let loading: Promise<void> | undefined;

export { mediaReferenceKey } from "@/lib/media-reference";

function recordKey(identity: string, scope: string) {
    return JSON.stringify([identity, scope]);
}

export function getMediaReferenceRecord(item: MediaReferenceInput, scope: string) {
    return useMediaReferenceStore.getState().records[recordKey(mediaReferenceKey(item), scope)];
}

export function findMediaReferenceRecords(item: MediaReferenceInput) {
    const identity = mediaReferenceKey(item);
    return Object.values(useMediaReferenceStore.getState().records).filter((record) => record.identity === identity);
}

export async function saveMediaReferenceRecord(record: Omit<MediaReferenceRecord, "key" | "updatedAt"> & Partial<Pick<MediaReferenceRecord, "key" | "updatedAt">>) {
    const key = record.key || recordKey(record.identity, record.scope);
    const saved = { ...record, key, updatedAt: record.updatedAt || Date.now() } as MediaReferenceRecord;
    useMediaReferenceStore.setState((state) => ({ records: { ...state.records, [key]: saved } }));
    await storage.setItem(key, saved);
    return saved;
}

export function setMediaReferenceProgress(key: string, message?: string) {
    useMediaReferenceStore.setState((state) => {
        const progress = { ...state.progress };
        if (message) progress[key] = message;
        else delete progress[key];
        return { progress };
    });
}

export async function runMediaReferenceWork(key: string, work: () => Promise<string>, signal?: AbortSignal) {
    let promise = running.get(key);
    if (!promise) {
        useMediaReferenceStore.setState((state) => ({ pending: new Set(state.pending).add(key) }));
        promise = work().finally(() => {
            running.delete(key);
            useMediaReferenceStore.setState((state) => { const pending = new Set(state.pending); pending.delete(key); return { pending }; });
        });
        running.set(key, promise);
    }
    return waitForCaller(promise, signal);
}

function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(abortError(signal));
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(abortError(signal));
        signal.addEventListener("abort", abort, { once: true });
        promise.then(
            (value) => { signal.removeEventListener("abort", abort); resolve(value); },
            (error) => { signal.removeEventListener("abort", abort); reject(error); },
        );
    });
}

function abortError(signal: AbortSignal) {
    return signal.reason instanceof Error ? signal.reason : new DOMException("请求已取消。", "AbortError");
}

export const useMediaReferenceStore = create<MediaReferenceStore>((set, get) => ({
    records: {},
    pending: new Set(),
    progress: {},
    load: () => loading ||= (async () => {
        const records: Record<string, MediaReferenceRecord> = {};
        await storage.iterate<MediaReferenceRecord, void>((record, key) => { records[key] = record; });
        set({ records: { ...records, ...get().records } });
    })().catch((error) => { loading = undefined; throw error; }),
}));
