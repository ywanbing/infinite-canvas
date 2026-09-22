import "./browser-storage";
import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import axios from "axios";
import localforage from "localforage";

const storageSpies: Array<{ mockRestore(): void }> = [];
const localforagePrototype = Object.getPrototypeOf(localforage) as typeof localforage;
const originalCreateInstance = localforagePrototype.createInstance;
const createInstance = spyOn(localforagePrototype, "createInstance").mockImplementation(function (options) {
    const instance = originalCreateInstance.call(this, options);
    storageSpies.push(
        spyOn(instance, "iterate").mockResolvedValue(undefined),
        spyOn(instance, "setItem").mockImplementation(async (_key, value) => value),
    );
    return instance;
});

const { createModelChannel, defaultConfig } = await import("../src/stores/use-config-store");
const { createVideoGenerationTask } = await import("../src/services/api/video");

const post = spyOn(axios, "post");
afterEach(() => post.mockReset());
afterAll(() => { post.mockRestore(); storageSpies.forEach((mock) => mock.mockRestore()); createInstance.mockRestore(); });

test("Seedance rejects unreviewed images before creating a paid task when audit credentials are missing", async () => {
    post.mockResolvedValue({ data: { id: "should-not-create" } });
    const model = "ark::doubao-seedance-2-0-260128";
    const config = { ...defaultConfig, model, videoMode: "first_frame", size: "16:9", vquality: "720", channels: [createModelChannel({ id: "ark", apiFormat: "ark", baseUrl: "https://example.com/api/v3", apiKey: "key", models: [{ name: "doubao-seedance-2-0-260128", capability: "video" }] })] };
    await expect(createVideoGenerationTask(config, "人物行走", [{ id: "outside", name: "上传的人像", type: "image/png", dataUrl: "https://example.com/photo.png" }])).rejects.toThrow("请先配置完整的火山素材审核凭据和素材组 ID");
    expect(post).not.toHaveBeenCalled();
});

test("invalid reference counts fail before any upload or audit", async () => {
    const config = { ...defaultConfig, model: "ark::doubao-seedance-2-0-260128", videoMode: "first_frame", size: "16:9", vquality: "720", channels: [createModelChannel({ id: "ark", apiFormat: "ark", apiKey: "key", models: [{ name: "doubao-seedance-2-0-260128", capability: "video" }] })] };
    await expect(createVideoGenerationTask(config, "行走", [])).rejects.toThrow("1 张图片");
    expect(post).not.toHaveBeenCalled();
});
