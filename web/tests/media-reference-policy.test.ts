import "./browser-storage";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import axios from "axios";
import localforage from "localforage";

const values = new Map<string, unknown>();
spyOn(localforage, "createInstance").mockReturnValue({
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: unknown) => { values.set(key, value); return value; },
    removeItem: async (key: string) => { values.delete(key); },
    iterate: async (callback: (value: unknown, key: string) => void) => { values.forEach(callback); },
} as ReturnType<typeof localforage.createInstance>);

const validateStorage = mock(() => undefined);
const uploadPublic = mock(async () => ({ url: "https://cdn.example.com/copied", key: "public/copied" }));
mock.module("../src/services/api/s3/media", () => ({ validatePublicMediaStorage: validateStorage, uploadPublicMedia: uploadPublic }));

const { createModelChannel, defaultConfig } = await import("../src/stores/use-config-store");
const { isArkMediaExempt, mediaReferenceKey } = await import("../src/lib/media-reference");
const { mediaReferenceScope, prepareMediaReference } = await import("../src/services/api/media-reference-policy");
const { getMediaReferenceRecord, useMediaReferenceStore } = await import("../src/stores/use-media-reference-store");

function config(format: "ark" | "kexiang" = "ark") {
    const channel = createModelChannel({
        id: `${format}-channel`,
        apiFormat: format,
        apiKey: "secret-key",
        baseUrl: `https://${format}.example.com`,
        models: [{ name: "seedance-test", capability: "video" }],
        arkAssets: format === "ark" ? { accessKeyId: "access", secretAccessKey: "secret", groupId: "group", projectName: "project" } : undefined,
    });
    return { ...defaultConfig, model: `${channel.id}::seedance-test`, channels: [channel] };
}

let post: ReturnType<typeof spyOn<typeof axios, "post">>;
let get: ReturnType<typeof spyOn<typeof axios, "get">>;
beforeEach(() => {
    values.clear();
    useMediaReferenceStore.setState({ records: {}, pending: new Set(), progress: {} });
    validateStorage.mockClear();
    uploadPublic.mockClear();
    post = spyOn(axios, "post").mockImplementation(async (url) => ({ data: { Result: String(url).includes("Action=GetAsset") ? { Id: "ark-1", Status: "Active" } : { Id: "ark-1" } } }));
    get = spyOn(axios, "get").mockResolvedValue({ data: { Result: { Id: "ark-1", Status: "Active" } } });
});
afterEach(() => { post.mockRestore(); get.mockRestore(); });

describe("Seedance media reference policy", () => {
    test("keeps a trusted Ark source exempt for exactly 30 days without changing the input", async () => {
        const now = Date.now();
        const item = { id: "preview", dataUrl: "blob:preview", url: "https://ark.example.com/image", mediaSource: { id: "generation-1", origin: "ark" as const, generatedAt: now - 30 * 24 * 60 * 60 * 1000 + 1000 } };
        const snapshot = structuredClone(item);
        expect(await prepareMediaReference(config(), item, "image")).toBe(item.url);
        expect(item).toEqual(snapshot);
        expect(post).not.toHaveBeenCalled();

        expect(isArkMediaExempt({ ...item, mediaSource: { ...item.mediaSource, id: "generation-2", generatedAt: now - 30 * 24 * 60 * 60 * 1000 } }, now)).toBe(false);
    });

    test("persists a processing Ark id and resumes by querying instead of creating twice", async () => {
        let queries = 0;
        post.mockImplementation(async (url) => ({ data: { Result: String(url).includes("Action=GetAsset") ? { Id: "ark-1", Status: ++queries === 1 ? "Processing" : "Active" } : { Id: "ark-1" } } }));
        const item = { storageKey: "image:stable", dataUrl: "data:image/png;base64,aQ==", name: "参考图" };
        await expect(prepareMediaReference(config(), item, "image")).rejects.toThrow("审核中");
        expect(post.mock.calls.filter(([url]) => String(url).includes("Action=CreateAsset"))).toHaveLength(1);
        expect((await prepareMediaReference(config(), item, "image"))).toBe("asset://ark-1");
        expect(post.mock.calls.filter(([url]) => String(url).includes("Action=CreateAsset"))).toHaveLength(1);
        expect(post.mock.calls.filter(([url]) => String(url).includes("Action=GetAsset"))).toHaveLength(2);
    });

    test("does not reuse an audit across credentials or channel scopes", async () => {
        const item = { storageKey: "image:scoped", url: "https://example.com/image.png" };
        expect(await prepareMediaReference(config(), item, "image")).toBe("asset://ark-1");
        const changed = config();
        changed.channels[0].arkAssets!.accessKeyId = "other-access";
        expect(await prepareMediaReference(changed, item, "image")).toBe("asset://ark-1");
        expect(post.mock.calls.filter(([url]) => String(url).includes("Action=CreateAsset"))).toHaveLength(2);
    });

    test("deduplicates concurrent creation and rejects an aborted caller before returning", async () => {
        let release!: () => void;
        post.mockImplementation((url) => String(url).includes("Action=GetAsset")
            ? Promise.resolve({ data: { Result: { Id: "ark-1", Status: "Active" } } })
            : new Promise((resolve) => { release = () => resolve({ data: { Result: { Id: "ark-1" } } }); }));
        const item = { storageKey: "video:stable", url: "https://example.com/video.mp4" };
        const first = prepareMediaReference(config(), item, "video");
        const firstResult = first.catch((error) => error as Error);
        const controller = new AbortController();
        const second = prepareMediaReference(config(), item, "video", { signal: controller.signal });
        const secondResult = second.catch((error) => error as Error);
        controller.abort();
        while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
        release();
        expect(await firstResult).toBe("asset://ark-1");
        expect((await secondResult).name).toBe("AbortError");
        expect(post.mock.calls.filter(([url]) => String(url).includes("Action=CreateAsset"))).toHaveLength(1);
    });

    test("binds a bare asset id to the first exact scope and rejects another scope", async () => {
        const item = { arkAssetSource: "stable-source", referenceUrl: "asset://known" };
        expect(await prepareMediaReference(config("kexiang"), item, "video")).toBe("asset://known");
        const other = config("kexiang");
        other.channels[0].apiKey = "other-secret";
        await expect(prepareMediaReference(other, item, "video")).rejects.toThrow("其他渠道");
        expect(getMediaReferenceRecord(item, await mediaReferenceScope(config("kexiang"), "video"))?.assetId).toBe("known");
    });

    test("forceAudit bypasses a cached exemption and old models reject every asset id", async () => {
        const now = Date.now();
        const item = { url: "https://ark.example.com/image", mediaSource: { id: "forced", origin: "ark" as const, generatedAt: now } };
        expect(await prepareMediaReference(config(), item, "image")).toBe(item.url);
        expect(await prepareMediaReference(config(), item, "image", { forceAudit: true })).toBe("asset://ark-1");
        await expect(prepareMediaReference(config(), { arkAssetSource: "manual", referenceUrl: "asset://known" }, "image", { supportsAssets: false })).rejects.toThrow("不支持");
    });

    test("validates Ark audit credentials before uploading local media", async () => {
        const input = config();
        input.channels[0].arkAssets = undefined;
        await expect(prepareMediaReference(input, { storageKey: "image:missing", dataUrl: "data:image/png;base64,aQ==" }, "image")).rejects.toThrow("凭据");
        expect(uploadPublic).not.toHaveBeenCalled();
    });

    test("rejects unknown Ark query status and keeps the created id", async () => {
        post.mockImplementation(async (url) => ({ data: { Result: String(url).includes("Action=GetAsset") ? { Id: "ark-1", Status: "Mystery" } : { Id: "ark-1" } } }));
        const item = { storageKey: "image:unknown", url: "https://example.com/image.png" };
        await expect(prepareMediaReference(config(), item, "image")).rejects.toThrow("未知");
        const record = getMediaReferenceRecord(item, await mediaReferenceScope(config(), "image"));
        expect(record?.arkAssetId).toBe("ark-1");
        expect(record?.status).toBe("processing");
        expect(record?.error).toContain("未知");
    });

    test("persists one public copy before audit failure and reuses it in another scope", async () => {
        post.mockRejectedValue(new Error("create failed"));
        const item = { mediaSource: { id: "same-media", origin: "other" as const, originalUrl: "https://expired.example.com/image", urlExpiresAt: Date.now() - 1 }, dataUrl: "data:image/png;base64,aQ==" };
        await expect(prepareMediaReference(config(), item, "image")).rejects.toThrow("create failed");
        const changed = config();
        changed.channels[0].arkAssets!.accessKeyId = "another-access";
        await expect(prepareMediaReference(changed, item, "image")).rejects.toThrow("create failed");
        expect(uploadPublic).toHaveBeenCalledTimes(1);
    });

    test("keeps stable identity when provenance is added to a local clone", () => {
        expect(mediaReferenceKey({ storageKey: "image:original" })).toBe(mediaReferenceKey({ storageKey: "image:clone", mediaSource: { id: "image:original", origin: "upload" } }));
    });

    test("Kexiang persists pending query id, resumes it, and clears the old error on active", async () => {
        let queries = 0;
        post.mockResolvedValue({ data: { id: 12, status: "pending" } });
        get.mockImplementation(async () => ({ data: { id: 12, status: ++queries === 1 ? "pending" : "active", asset_id: queries === 2 ? "kx-asset" : undefined } }));
        const item = { storageKey: "video:kx", url: "https://example.com/video.mp4" };
        await expect(prepareMediaReference(config("kexiang"), item, "video")).rejects.toThrow("审核中");
        const scope = await mediaReferenceScope(config("kexiang"), "video");
        expect(getMediaReferenceRecord(item, scope)).toMatchObject({ status: "processing", kexiangQueryId: 12 });
        expect(await prepareMediaReference(config("kexiang"), item, "video")).toBe("asset://kx-asset");
        expect(getMediaReferenceRecord(item, scope)?.error).toBeUndefined();
        expect(post).toHaveBeenCalledTimes(1);
    });

    test("Kexiang rejects failed, unknown, mismatched, and active responses without an asset id", async () => {
        const item = { storageKey: "video:kx-invalid", url: "https://example.com/video.mp4" };
        post.mockResolvedValue({ data: { id: 21, status: "pending" } });
        get.mockResolvedValueOnce({ data: { id: 21, status: "failed", error_msg: "审核拒绝" } });
        await expect(prepareMediaReference(config("kexiang"), item, "video")).rejects.toThrow("审核拒绝");

        const unknown = { storageKey: "video:kx-unknown", url: "https://example.com/unknown.mp4" };
        post.mockResolvedValueOnce({ data: { id: 22, status: "pending" } });
        get.mockResolvedValueOnce({ data: { id: 22, status: "mystery" } });
        await expect(prepareMediaReference(config("kexiang"), unknown, "video")).rejects.toThrow("未知状态");

        const mismatch = { storageKey: "video:kx-mismatch", url: "https://example.com/mismatch.mp4" };
        post.mockResolvedValueOnce({ data: { id: 23, status: "pending" } });
        get.mockResolvedValueOnce({ data: { id: 999, status: "active", asset_id: "wrong" } });
        await expect(prepareMediaReference(config("kexiang"), mismatch, "video")).rejects.toThrow("查询 ID");

        const missing = { storageKey: "video:kx-missing", url: "https://example.com/missing.mp4" };
        post.mockResolvedValueOnce({ data: { id: 24, status: "active" } });
        get.mockResolvedValueOnce({ data: { id: 24, status: "active" } });
        await expect(prepareMediaReference(config("kexiang"), missing, "video")).rejects.toThrow("asset_id");
    });

    test("reports public upload progress and clears it after a trusted copy", async () => {
        const messages: string[] = [];
        const item = { dataUrl: "data:image/png;base64,aQ==", mediaSource: { id: "trusted-local", origin: "ark" as const, generatedAt: Date.now(), originalUrl: "https://expired.example.com/image", urlExpiresAt: Date.now() - 1 } };
        expect(await prepareMediaReference(config(), item, "image", { onProgress: (message) => messages.push(message) })).toBe("https://cdn.example.com/copied");
        expect(messages).toContain("正在上传公网素材…");
        expect(Object.keys(useMediaReferenceStore.getState().progress)).toHaveLength(0);
    });
});
