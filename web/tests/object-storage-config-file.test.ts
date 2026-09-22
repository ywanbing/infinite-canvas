import "./browser-storage";
import { afterEach, expect, spyOn, test } from "bun:test";
import * as FileSaver from "file-saver";
import { defaultObjectStorageConfig } from "../src/services/api/s3/config";
import { exportAppConfig, importAppConfig } from "../src/services/config-file";
import { defaultConfig, defaultWebdavSyncConfig, useConfigStore } from "../src/stores/use-config-store";
import { usePromptSourceStore } from "../src/stores/use-prompt-source-store";

const initial = useConfigStore.getState();
const prompts = usePromptSourceStore.getState();
afterEach(() => {
    useConfigStore.setState(initial);
    usePromptSourceStore.setState(prompts);
});

for (const providerConfig of [
    { provider: "qiniu", region: "cn-south-1", endpoint: "https://fixture.s3.cn-south-1.qiniucs.com", forcePathStyle: false },
    { provider: "volcengine", region: "cn-beijing", endpoint: "https://fixture.tos-s3-cn-beijing.volces.com", forcePathStyle: false },
    { provider: "generic", region: "auto", endpoint: "http://storage.example.com:9000", forcePathStyle: true },
] as const) {
    test(`exports and reimports ${providerConfig.provider} credentials, region, endpoint and addressing together`, async () => {
        const storage = { ...defaultObjectStorageConfig, ...providerConfig, enabled: true, accessKey: "fixture-ak", secretKey: "fixture-sk", bucket: "fixture", publicBaseUrl: "https://media.example.com" };
        useConfigStore.setState({ objectStorage: storage, objectStorageProfiles: {} });
        const save = spyOn(FileSaver, "saveAs").mockImplementation(() => {});
        try {
            exportAppConfig();
            const blob = save.mock.calls[0][0] as Blob;
            const data = JSON.parse(await blob.text());
            expect(data.objectStorage).toEqual(storage);
            useConfigStore.setState({ objectStorage: defaultObjectStorageConfig });
            await importAppConfig(new File([blob], "settings.json"));
            expect(useConfigStore.getState().objectStorage).toEqual(storage);
        } finally {
            save.mockRestore();
        }
    });
}

test("rejects malformed cloud settings before changing any current settings", async () => {
    const before = useConfigStore.getState();
    for (const objectStorage of [undefined, null, { ...defaultObjectStorageConfig, secretKey: 123 }, { ...defaultObjectStorageConfig, publicBaseUrl: 123 }, { ...defaultObjectStorageConfig, forcePathStyle: "true" }, { ...defaultObjectStorageConfig, provider: "generic", region: 123 }, { ...defaultObjectStorageConfig, provider: "volcengine", region: "cn-south-1" }, { enabled: false, provider: "qiniu", accessKey: "", secretKey: "", bucket: "", region: "cn-south-1", endpoint: "" }, { ...defaultObjectStorageConfig, provider: "unknown" }, { ...defaultObjectStorageConfig, provider: ["qiniu"] }, { ...defaultObjectStorageConfig, provider: "__proto__" }]) {
        const data = { app: "infinite-canvas", version: 1, config: { ...defaultConfig, systemPrompt: "must not be applied" }, webdav: defaultWebdavSyncConfig, objectStorage, objectStorageProfiles: {}, promptSources: { sources: [], schedule: prompts.schedule } };
        await expect(importAppConfig(new File([JSON.stringify(data)], "invalid.json"))).rejects.toThrow();
        expect(useConfigStore.getState().config).toBe(before.config);
        expect(useConfigStore.getState().objectStorage).toBe(before.objectStorage);
        expect(usePromptSourceStore.getState().sources).toBe(prompts.sources);
    }
});

test("exports all provider profiles and restores them when switching after import", async () => {
    useConfigStore.setState({ objectStorage: defaultObjectStorageConfig, objectStorageProfiles: {} });
    const update = useConfigStore.getState().updateObjectStorageConfig;
    update("secretKey", "qiniu-fixture-sk");
    const qiniu = useConfigStore.getState().objectStorage;
    update("provider", "volcengine");
    update("publicBaseUrl", "https://tos-media.example.com");
    const volcengine = useConfigStore.getState().objectStorage;
    update("provider", "generic");
    update("endpoint", "http://storage.example.com:9000");
    const generic = useConfigStore.getState().objectStorage;
    const save = spyOn(FileSaver, "saveAs").mockImplementation(() => {});
    try {
        exportAppConfig();
        const blob = save.mock.calls[0][0] as Blob;
        const data = JSON.parse(await blob.text());
        expect(data.objectStorageProfiles).toEqual({ qiniu, volcengine });
        useConfigStore.setState({ objectStorage: defaultObjectStorageConfig, objectStorageProfiles: {} });
        await importAppConfig(new File([blob], "settings.json"));
        expect(useConfigStore.getState().objectStorage).toEqual(generic);
        update("provider", "qiniu");
        expect(useConfigStore.getState().objectStorage).toEqual(qiniu);
        update("provider", "volcengine");
        expect(useConfigStore.getState().objectStorage).toEqual(volcengine);

        const before = useConfigStore.getState();
        for (const objectStorageProfiles of [undefined, [], { unknown: qiniu }, { qiniu: volcengine }, { qiniu: { ...qiniu, secretKey: 123 } }, { generic }]) {
            await expect(importAppConfig(new File([JSON.stringify({ ...data, objectStorageProfiles })], "invalid.json"))).rejects.toThrow();
            expect(useConfigStore.getState().objectStorage).toBe(before.objectStorage);
            expect(useConfigStore.getState().objectStorageProfiles).toBe(before.objectStorageProfiles);
        }
    } finally {
        save.mockRestore();
    }
});

test("preserves incomplete generic region drafts during export and import", async () => {
    useConfigStore.setState({ objectStorage: defaultObjectStorageConfig, objectStorageProfiles: {} });
    const update = useConfigStore.getState().updateObjectStorageConfig;
    update("provider", "generic");
    update("region", "");
    update("accessKey", "draft-ak");
    update("provider", "qiniu");
    const save = spyOn(FileSaver, "saveAs").mockImplementation(() => {});
    try {
        exportAppConfig();
        const blob = save.mock.calls[0][0] as Blob;
        useConfigStore.setState({ objectStorage: defaultObjectStorageConfig, objectStorageProfiles: {} });
        await importAppConfig(new File([blob], "drafts.json"));
        update("provider", "generic");
        expect(useConfigStore.getState().objectStorage).toMatchObject({ region: "", accessKey: "draft-ak" });
    } finally {
        save.mockRestore();
    }
});
