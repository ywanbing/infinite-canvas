import { create } from "zustand";
import localforage from "localforage";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { resolveModelChannel, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { deleteStoredImages, ensureImagePreview, resolveImageUrl, uploadImage } from "@/services/image-storage";

export type GeneratedImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType?: string;
    status?: "pending" | "failed";
    error?: string;
};

type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "count" | "background" | "arkImageOptions">;

export type GenerationLog = {
    id: string;
    createdAt: number;
    startedAt?: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    size: string;
    quality: string;
    status: "pending" | "success" | "failed";
    images: GeneratedImage[];
};

type ImageWorkbenchStore = {
    logs: GenerationLog[];
    loaded: boolean;
    storageError: string;
    load: () => Promise<void>;
    generate: (prompt: string, config: AiConfig, references: ReferenceImage[], count: number) => GenerationLog;
    retry: (logId: string, slotId: string, config: AiConfig) => Promise<void>;
    remove: (ids: string[]) => Promise<void>;
};

const logStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
let loading: Promise<void> | undefined;
let writes = Promise.resolve();
const activeLogs = new Set<string>();
const deletingLogs = new Set<string>();

function persist(log: GenerationLog) {
    const stored = {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        images: log.images.map((image) => ({ ...image, dataUrl: image.storageKey ? "" : image.dataUrl })),
    };
    const write = writes.then(() => logStore.setItem(log.id, stored));
    writes = write.then(() => {}, () => { useImageWorkbenchStore.setState({ storageError: "生成记录无法保存到本地，请勿刷新页面。" }); });
    return write;
}

function updateSlot(logId: string, slotId: string, image: GeneratedImage) {
    const log = useImageWorkbenchStore.getState().logs.find((item) => item.id === logId);
    if (!log) return;
    const images = log.images.map((item) => item.id === slotId ? image : item);
    const successCount = images.filter((item) => item.dataUrl).length;
    const failCount = images.filter((item) => item.status === "failed").length;
    const next: GenerationLog = {
        ...log, images, successCount, failCount,
        startedAt: image.status === "pending" && log.status !== "pending" ? Date.now() : log.startedAt,
        status: images.some((item) => item.status === "pending") ? "pending" : successCount ? "success" : "failed",
        durationMs: Math.max(...images.map((item) => item.durationMs)),
    };
    useImageWorkbenchStore.setState((state) => ({ logs: state.logs.map((item) => item.id === logId ? next : item) }));
    return next;
}

async function runSlot(log: GenerationLog, slot: GeneratedImage, config: AiConfig) {
    const startedAt = performance.now();
    let next: GeneratedImage;
    try {
        // Save the pending slot before issuing a request, including on retry.
        await persist(log);
        if (log.model.includes("::") && !config.channels.some((channel) => channel.id === log.model.split("::")[0])) throw new Error("该记录所属渠道已删除，请恢复原渠道后重试。");
        const channelId = resolveModelChannel(config, log.model).id;
        const requestConfig = { ...config, ...log.config, model: log.model, count: "1", channels: config.channels.map((channel) => channel.id === channelId ? { ...channel, arkImageOptions: log.config.arkImageOptions } : channel) };
        const result = log.references.length ? await requestEdit(requestConfig, log.prompt, log.references) : await requestGeneration(requestConfig, log.prompt);
        if (!result[0]) throw new Error(i18n.t("imageWorkbench.missingResult"));
        const stored = await uploadImage(result[0].dataUrl);
        next = { id: slot.id, dataUrl: stored.url, storageKey: stored.storageKey, durationMs: performance.now() - startedAt, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType };
    } catch (error) {
        next = { ...slot, status: "failed", durationMs: performance.now() - startedAt, error: error instanceof Error ? error.message : i18n.t("workbench.generationFailed") };
    }
    const updated = updateSlot(log.id, slot.id, next);
    if (updated) await persist(updated).catch(() => {});
}

export const useImageWorkbenchStore = create<ImageWorkbenchStore>((set, get) => ({
    logs: [],
    loaded: false,
    storageError: "",
    load: () => {
        if (get().loaded) return Promise.resolve();
        if (loading) return loading;
        loading = (async () => {
            const values: GenerationLog[] = [];
            await logStore.iterate<GenerationLog, void>((log) => { values.push(log); });
            const logs = await Promise.all(values.map(async (log) => {
                const images = await Promise.all(log.images.map(async (image) => {
                    void ensureImagePreview(image.storageKey);
                    return { ...image, dataUrl: await resolveImageUrl(image.storageKey, image.dataUrl) };
                }));
                const references = await Promise.all(log.references.map(async (item) => {
                    void ensureImagePreview(item.storageKey);
                    return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
                }));
                const interrupted = images.some((item) => item.status === "pending");
                const next: GenerationLog = { ...log, images, references };
                if (interrupted) {
                    next.images = images.map((item) => item.status === "pending" ? { ...item, status: "failed", error: "请求中断，结果未知。可手动重试；重试会重新发起生成请求。" } : item);
                    next.failCount = next.images.filter((item) => item.status === "failed").length;
                    next.status = next.successCount ? "success" : "failed";
                    await persist(next).catch(() => {});
                }
                return next;
            }));
            set({ logs: logs.sort((a, b) => b.createdAt - a.createdAt), loaded: true });
        })().finally(() => { loading = undefined; });
        return loading;
    },
    generate: (prompt, config, references, count) => {
        const log: GenerationLog = {
            id: nanoid(), createdAt: Date.now(), startedAt: Date.now(), title: prompt.slice(0, 12), prompt,
            time: new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }), model: config.model,
            config: { model: config.model, imageModel: config.model, quality: config.quality, size: config.size, count: String(count), background: config.background, arkImageOptions: resolveModelRequestConfig(config, config.model).arkImageOptions },
            references: [...references], durationMs: 0, successCount: 0, failCount: 0, imageCount: count,
            size: config.size, quality: config.quality, status: "pending",
            images: Array.from({ length: count }, () => ({ id: nanoid(), status: "pending", dataUrl: "", durationMs: 0, width: 0, height: 0, bytes: 0 })),
        };
        set((state) => ({ logs: [log, ...state.logs] }));
        return log;
    },
    retry: async (logId, slotId, config) => {
        const log = get().logs.find((item) => item.id === logId);
        const slot = log?.images.find((item) => item.id === slotId);
        if (!log || !slot || slot.status !== "failed" || deletingLogs.has(logId)) return;
        const pending: GeneratedImage = { ...slot, status: "pending", error: undefined };
        const updated = updateSlot(logId, slotId, pending);
        if (updated) await runSlot(updated, pending, config);
    },
    remove: async (ids) => {
        const selected = get().logs.filter((log) => ids.includes(log.id));
        if (selected.some((log) => log.status === "pending" || activeLogs.has(log.id))) throw new Error("请等待任务结束后再删除生成记录。");
        ids.forEach((id) => deletingLogs.add(id));
        try {
            await writes;
            await Promise.all(selected.map((log) => logStore.removeItem(log.id)));
            set((state) => ({ logs: state.logs.filter((log) => !ids.includes(log.id)) }));
            await deleteStoredImages(selected.flatMap((log) => log.images.flatMap((image) => image.storageKey ? [image.storageKey] : [])));
        } finally {
            ids.forEach((id) => deletingLogs.delete(id));
        }
    },
}));

export async function runImageGeneration(log: GenerationLog, config: AiConfig) {
    activeLogs.add(log.id);
    try {
        await Promise.all(log.images.map((slot) => runSlot(log, slot, config)));
        return useImageWorkbenchStore.getState().logs.find((item) => item.id === log.id)!;
    } finally {
        activeLogs.delete(log.id);
    }
}
