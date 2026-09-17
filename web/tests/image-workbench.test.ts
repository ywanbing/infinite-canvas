import "./browser-storage";
import { expect, spyOn, test } from "bun:test";
import localforage from "localforage";
import * as imageApi from "../src/services/api/image";
import * as imageStorage from "../src/services/image-storage";
import { createModelChannel, defaultConfig } from "../src/stores/use-config-store";

test("records pending slots, preserves mixed results and retries the original slot and request", async () => {
    const saved = new Map<string, any>();
    const storage = spyOn(localforage, "createInstance").mockReturnValue({
        setItem: async (id: string, value: unknown) => { saved.set(id, structuredClone(value)); return value; },
        iterate: async (callback: (value: unknown) => void) => { saved.forEach(callback); },
        removeItem: async (id: string) => { saved.delete(id); },
    } as never);
    const completions: Array<{ resolve: (value: any) => void; reject: (error: Error) => void }> = [];
    const request = spyOn(imageApi, "requestGeneration").mockImplementation(() => new Promise((resolve, reject) => completions.push({ resolve, reject })));
    const upload = spyOn(imageStorage, "uploadImage").mockImplementation(async () => ({ url: "blob:result", storageKey: "stored-image", width: 100, height: 100, bytes: 50, mimeType: "image/png" }));
    const resolveUrl = spyOn(imageStorage, "resolveImageUrl").mockImplementation(async (key, fallback = "") => key ? `blob:${key}` : fallback);
    const preview = spyOn(imageStorage, "ensureImagePreview").mockResolvedValue(undefined);
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    try {
        const { useImageWorkbenchStore, runImageGeneration } = await import("../src/stores/use-image-workbench-store");
        const store = useImageWorkbenchStore;
        await store.getState().load();
        const config = { ...defaultConfig, model: "test::image", size: "1024x1024", channels: [createModelChannel({ id: "test", apiKey: "test-key", models: [{ name: "image", capability: "image" }] })] };
        const log = store.getState().generate("original prompt", config, [], 2);
        expect(store.getState().logs[0].status).toBe("pending");
        const batch = runImageGeneration(log, config);
        await tick();
        expect(saved.get(log.id).images.map((item: any) => item.status)).toEqual(["pending", "pending"]);
        expect(completions).toHaveLength(2);
        await expect(store.getState().remove([log.id])).rejects.toThrow("请等待任务结束");
        completions[1].reject(new Error("upstream failed"));
        await tick();
        expect(store.getState().logs[0].failCount).toBe(1);
        expect(store.getState().logs[0].status).toBe("pending");
        completions[0].resolve([{ id: "api-image", dataUrl: "data:image/png;base64,test" }]);
        await batch;
        expect(store.getState().logs).toHaveLength(1);
        expect(saved.get(log.id).images[1].error).toBe("upstream failed");

        store.setState({ logs: [], loaded: false });
        await store.getState().load();
        const restored = store.getState().logs[0];
        expect(restored.images[0].dataUrl).toBe("blob:stored-image");
        expect(restored.images[1].error).toBe("upstream failed");
        const retry = store.getState().retry(log.id, log.images[1].id, { ...config, size: "2048x2048" });
        await store.getState().retry(log.id, log.images[1].id, config);
        await tick();
        expect(completions).toHaveLength(3);
        expect(request.mock.calls[2][0].size).toBe("1024x1024");
        expect(request.mock.calls[2][1]).toBe("original prompt");
        completions[2].resolve([{ id: "retry-image", dataUrl: "data:image/png;base64,retry" }]);
        await retry;
        expect(store.getState().logs).toHaveLength(1);
        expect(store.getState().logs[0]).toMatchObject({ id: log.id, successCount: 2, failCount: 0 });
        expect(store.getState().logs[0].images[0]).toEqual(restored.images[0]);
        expect(store.getState().logs[0].images[1].id).toBe(log.images[1].id);

        const interrupted = store.getState().generate("interrupted", config, [], 1);
        saved.set(interrupted.id, structuredClone(interrupted));
        store.setState({ logs: [], loaded: false });
        await store.getState().load();
        expect(store.getState().logs.find((item) => item.id === interrupted.id)?.images[0]).toMatchObject({ status: "failed", error: expect.stringContaining("结果未知") });
        expect(completions).toHaveLength(3);
    } finally {
        [storage, request, upload, resolveUrl, preview].forEach((spy) => spy.mockRestore());
    }
});
