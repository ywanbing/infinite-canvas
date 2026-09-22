import "./browser-storage";
import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
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

const { createModelChannel, defaultConfig, useConfigStore } = await import("../src/stores/use-config-store");
const { createVideoGenerationTask, pollVideoGenerationTask, waitForVideoGenerationTask } = await import("../src/services/api/video");
const { arkVideoModels, resolveArkVideoModel, validateArkVideoSettings } = await import("../src/lib/video-model-config");

function config(model = "doubao-seedance-2-0-260128") {
    return { ...defaultConfig, model: `ark-video::${model}`, videoMode: "text", size: "adaptive", vquality: "4k", videoSeconds: "-1", channels: [createModelChannel({ id: "ark-video", apiFormat: "ark", baseUrl: "https://example.com/api/v3", apiKey: "test-key", models: [{ name: model, capability: "video" }] })] };
}
let post: ReturnType<typeof spyOn<typeof axios, "post">>;
let get: ReturnType<typeof spyOn<typeof axios, "get">>;
beforeEach(() => {
    post = spyOn(axios, "post").mockResolvedValue({ data: { id: "task-1" } });
    get = spyOn(axios, "get").mockResolvedValue({ data: { status: "queued" } });
});
afterEach(() => { post.mockRestore(); get.mockRestore(); useConfigStore.setState({ config: defaultConfig }); });
afterAll(() => { storageSpies.forEach((mock) => mock.mockRestore()); createInstance.mockRestore(); });

test("creates native Ark JSON with 4k and smart duration", async () => {
    expect(await createVideoGenerationTask(config(), "海浪")).toEqual({ id: "task-1", provider: "ark", model: "ark-video::doubao-seedance-2-0-260128", baseUrl: "https://example.com/api/v3", arkAccessMode: "api", createdAt: expect.any(Number) });
    expect(post.mock.calls[0][0]).toBe("https://example.com/api/v3/contents/generations/tasks");
    expect(post.mock.calls[0][1]).toMatchObject({ model: "doubao-seedance-2-0-260128", resolution: "4k", duration: -1, ratio: "adaptive", content: [{ type: "text", text: "海浪" }] });
});

test("rejects fast 1080p before HTTP", async () => {
    await expect(createVideoGenerationTask({ ...config("doubao-seedance-2-0-fast-260128"), vquality: "1080" }, "海浪")).rejects.toThrow("分辨率");
    expect(post).not.toHaveBeenCalled();
});

const imageRef = { id: "i", name: "image.png", type: "image/png", dataUrl: "", url: "asset://image" };
const videoRef = { id: "v", name: "video.mp4", type: "video/mp4", url: "https://example.com/video.mp4", durationMs: 4000, mediaSource: { id: "ark-video-v", origin: "ark" as const, channelId: "ark-video", model: "doubao-seedance-2-0-260128", generatedAt: Date.now(), originalUrl: "https://example.com/video.mp4" } };
const audioRef = { id: "a", name: "audio.wav", type: "audio/wav", url: "data:audio/wav;base64,AAAA", durationMs: 2000 };

test("registers seven models and resolves active Agent Plan aliases", () => {
    expect(arkVideoModels).toHaveLength(7);
    expect(resolveArkVideoModel("doubao-seedance-2-0-260128", "agent-plan")?.resolutions).toContain("4k");
    expect(resolveArkVideoModel("doubao-seedance-2.5", "agent-plan")?.modelId).toBe("doubao-seedance-2-5-260628");
    expect(resolveArkVideoModel("doubao-seedance-2.0-fast", "agent-plan")?.resolutions).toEqual(["480", "720"]);
    expect(resolveArkVideoModel("doubao-seedance-1.5-pro-即将下线", "agent-plan")).toBeUndefined();
    expect(resolveArkVideoModel("doubao-seedance-2-0-unknown")).toBeUndefined();
    expect(resolveArkVideoModel("doubao-seedance-2-0-fast-260128")?.resolutions).toEqual(["480", "720"]);
    expect(resolveArkVideoModel("doubao-seedance-2-0-mini-260615")?.resolutions).toEqual(["480", "720"]);
});

test("Agent Plan maps active aliases, accepts standard model IDs and rejects retired 1.5", async () => {
    const input = { ...config("doubao-seedance-2.0"), vquality: "4k" };
    input.channels[0].arkAccessMode = "agent-plan";
    await createVideoGenerationTask(input, "海浪");
    expect(post.mock.calls[0][1]).toHaveProperty("model", "doubao-seedance-2-0-260128");
    input.model = "ark-video::doubao-seedance-2-0-260128";
    input.channels[0].models[0].name = "doubao-seedance-2-0-260128";
    await createVideoGenerationTask(input, "海浪");
    expect(post.mock.calls[1][1]).toHaveProperty("model", "doubao-seedance-2-0-260128");
    input.model = "ark-video::doubao-seedance-2.5";
    input.channels[0].models[0].name = "doubao-seedance-2.5";
    await createVideoGenerationTask({ ...input, vquality: "720", videoSeconds: "-1" }, "海浪");
    expect(post.mock.calls[2][1]).toHaveProperty("model", "doubao-seedance-2-5-260628");
    const retired = { ...config("doubao-seedance-1.5-pro-即将下线"), vquality: "720" };
    retired.channels[0].arkAccessMode = "agent-plan";
    await expect(createVideoGenerationTask(retired, "海浪")).rejects.toThrow("已从 Agent Plan 下线");
    expect(post).toHaveBeenCalledTimes(3);
});

test.each(arkVideoModels)("maps $modelId display names to matching parameters and request IDs", async (profile) => {
    const alias = profile.modelPrefix.replace(/-(\d+)-(\d+)/, "-$1.$2").replace("doubao-seedance", "Doubao-Seedance");
    const input = { ...config(alias), size: profile.defaultRatio, vquality: profile.defaultResolution, videoSeconds: String(profile.duration.default) };
    expect(resolveArkVideoModel(alias)).toBe(profile);
    expect(resolveArkVideoModel(profile.modelPrefix)).toBe(profile);
    const task = await createVideoGenerationTask(input, "海浪");
    expect(post.mock.calls[0][1]).toMatchObject({ model: profile.modelId, resolution: `${profile.defaultResolution}p`, ratio: profile.defaultRatio, duration: profile.duration.default });
    expect(task.model).toBe(input.model);
});

test("validates fast alias parameters and preserves explicit model versions", async () => {
    await expect(createVideoGenerationTask({ ...config("Doubao-Seedance-2.0-fast"), vquality: "1080" }, "海浪")).rejects.toThrow("分辨率");
    expect(post).not.toHaveBeenCalled();
    await createVideoGenerationTask(config("doubao-seedance-2-0-260129"), "海浪");
    expect(post.mock.calls[0][1]).toHaveProperty("model", "doubao-seedance-2-0-260129");
});

test("preserves reference roles, remote sources, 4k and smart duration", async () => {
    await createVideoGenerationTask({ ...config(), videoMode: "reference" }, "", [imageRef], { videos: [videoRef], audios: [audioRef] });
    expect(post.mock.calls[0][1]).toMatchObject({ content: [
        { type: "image_url", image_url: { url: "asset://image" }, role: "reference_image" },
        { type: "video_url", video_url: { url: "https://example.com/video.mp4" }, role: "reference_video" },
        { type: "audio_url", audio_url: { url: "data:audio/wav;base64,AAAA" }, role: "reference_audio" },
    ], duration: -1, resolution: "4k" });
    expect(post.mock.calls[0][1]).not.toHaveProperty("omni_reference_task_type");
});

test("2.5 reference audio-only and explicit edit task rules", async () => {
    const input = { ...config("doubao-seedance-2-5-260628"), vquality: "720", videoMode: "reference" };
    await createVideoGenerationTask(input, "", [], { audios: [audioRef] });
    expect(post.mock.calls[0][1]).toHaveProperty("omni_reference_task_type", "reference");
    await expect(createVideoGenerationTask({ ...input, videoMode: "edit", videoSeconds: "6" }, "", [], { videos: [videoRef] })).rejects.toThrow("智能时长");
    await createVideoGenerationTask({ ...input, videoMode: "edit" }, "", [], { videos: [videoRef] });
    expect(post.mock.calls[1][1]).toHaveProperty("omni_reference_task_type", "edit");
    await expect(createVideoGenerationTask({ ...input, videoMode: "extend" }, "", [imageRef])).rejects.toThrow("必须提供参考视频");
    expect(validateArkVideoSettings({ ...input, videoMode: "first_frame", size: "16:9" })).toContain("adaptive");
});

test("legacy durations, ratios, tail frame and audio rules remain distinct", async () => {
    const input = { ...config("doubao-seedance-1-0-pro-250528"), size: "16:9", vquality: "1080", videoSeconds: "2" };
    await createVideoGenerationTask(input, "海浪");
    expect(post.mock.calls[0][1]).toHaveProperty("duration", 2);
    expect(post.mock.calls[0][1]).not.toHaveProperty("generate_audio");
    expect(validateArkVideoSettings({ ...input, size: "adaptive" })).toContain("比例");
    expect(validateArkVideoSettings({ ...input, videoSeconds: "-1" })).toContain("时长");
    expect(validateArkVideoSettings({ ...config("doubao-seedance-1-0-pro-fast-251015"), videoMode: "first_last_frame" })).toContain("模式");
});

test("rejects incompatible roles, counts, durations, bytes and local videos before HTTP", async () => {
    const input = { ...config(), videoMode: "reference" };
    const cases = [
        () => createVideoGenerationTask(config(), "海浪", [imageRef]),
        () => createVideoGenerationTask(input, "", [], { audios: [audioRef] }),
        () => createVideoGenerationTask(input, "", Array(10).fill(imageRef)),
        () => createVideoGenerationTask(input, "", [], { videos: [{ ...videoRef, url: "blob:local", mediaSource: undefined }] }),
        () => createVideoGenerationTask(input, "", [], { videos: [{ ...videoRef, durationMs: 16000 }] }),
        () => createVideoGenerationTask(input, "", [], { videos: [{ ...videoRef, bytes: 200 * 1024 ** 2 + 1 }] }),
        () => createVideoGenerationTask(input, "", [], { videos: [{ ...videoRef, width: 299 }] }),
        () => createVideoGenerationTask(input, "", [], { videos: [{ ...videoRef, durationMs: 8000 }, { ...videoRef, durationMs: 8000 }] }),
        () => createVideoGenerationTask(input, "", [{ ...imageRef, bytes: 30 * 1024 ** 2 }]),
    ];
    for (const run of cases) await expect(run()).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
});

test.each(["queued", "running"])("keeps %s pending and task channel identity", async (status) => {
    get.mockResolvedValue({ data: { status } });
    const task = { id: "task/1", provider: "ark" as const, model: "ark-video::doubao-seedance-2-0-260128" };
    expect(await pollVideoGenerationTask({ ...config(), model: "some-other-model" }, task)).toEqual({ status: "pending" });
    expect(get.mock.calls[0][0]).toBe("https://example.com/api/v3/contents/generations/tasks/task%2F1");
    expect(post).not.toHaveBeenCalled();
});

test("accepts a public HTTP reference without downloading or rewriting it", async () => {
    await createVideoGenerationTask({ ...config(), videoMode: "reference" }, "海浪", [], { videos: [{ ...videoRef, url: "http://example.com/video.mp4", mediaSource: { ...videoRef.mediaSource, id: "ark-video-http", originalUrl: "http://example.com/video.mp4" } }] });
    expect(post.mock.calls[0][1]).toHaveProperty("content.1.video_url.url", "http://example.com/video.mp4");
    expect(get).not.toHaveBeenCalled();
});

test("resumes using the saved endpoint after switching channel access mode", async () => {
    const input = config("doubao-seedance-2.0");
    input.channels[0].arkAccessMode = "agent-plan";
    input.channels[0].baseUrl = "https://example.com/api/plan/v3";
    const task = await createVideoGenerationTask({ ...input, vquality: "4k" }, "海浪");
    post.mockClear();
    input.channels[0].arkAccessMode = "api";
    input.channels[0].baseUrl = "https://example.com/api/v3";
    await pollVideoGenerationTask(input, task);
    expect(get.mock.calls[0][0]).toBe("https://example.com/api/plan/v3/contents/generations/tasks/task-1");
    expect(post).not.toHaveBeenCalled();
    await expect(pollVideoGenerationTask({ ...input, channels: [] }, task)).rejects.toThrow("渠道已删除");
    expect(get).toHaveBeenCalledTimes(1);
});

test("selects the encoded channel when two channels contain the same model", async () => {
    const input = config();
    input.channels.unshift(createModelChannel({ id: "other", apiFormat: "openai", baseUrl: "https://other.example/v1", apiKey: "other-key", models: [...input.channels[0].models] }));
    await createVideoGenerationTask(input, "海浪");
    expect(post.mock.calls[0][0]).toBe("https://example.com/api/v3/contents/generations/tasks");
    expect(post.mock.calls[0][2]?.headers).toMatchObject({ Authorization: "Bearer test-key" });
});

test.each(["expired", "failed", "cancelled"])("stops on %s with upstream error", async (status) => {
    get.mockResolvedValue({ data: { status, error: { message: "上游原因" } } });
    expect(await pollVideoGenerationTask(config(), { id: "1", model: config().model, provider: "ark" })).toEqual({ status: "failed", error: "上游原因" });
});

test("successful result downloads, missing URL fails, unknown status remains retriable", async () => {
    const task = { id: "1", model: config().model, provider: "ark" as const, createdAt: 1_000 };
    const blob = new Blob(["video"], { type: "video/mp4" });
    get.mockResolvedValueOnce({ data: { status: "succeeded", content: { video_url: "https://example.com/result.mp4" } } }).mockResolvedValueOnce({ data: blob });
    expect(await pollVideoGenerationTask(config(), task)).toEqual({ status: "completed", result: { blob, sourceUrl: "https://example.com/result.mp4", mediaSource: {
        id: '["ark",null,"ark-video::doubao-seedance-2-0-260128","1"]', origin: "ark", channelId: "ark-video", model: task.model,
        generatedAt: 1_000, originalUrl: "https://example.com/result.mp4", urlExpiresAt: 86_401_000,
    } } });
    get.mockResolvedValueOnce({ data: { status: "succeeded" } });
    expect((await pollVideoGenerationTask(config(), task)).status).toBe("failed");
    get.mockResolvedValueOnce({ data: { status: "unknown" } });
    await expect(pollVideoGenerationTask(config(), task)).rejects.toThrow("任务 ID 已保留");
    expect(post).not.toHaveBeenCalled();
});

test("propagates permission errors without retrying creation", async () => {
    post.mockRejectedValue(new axios.AxiosError("Denied", "ERR_BAD_REQUEST", undefined, undefined, { status: 403, data: { error: { message: "套餐无权限" } }, statusText: "Forbidden", headers: {}, config: {} as never }));
    await expect(createVideoGenerationTask(config(), "海浪")).rejects.toThrow("套餐无权限");
    expect(post).toHaveBeenCalledTimes(1);
});

test("proxy and cancellation apply to task requests but not reference URLs", async () => {
    useConfigStore.setState({ config: { ...defaultConfig, proxyEnabled: true } });
    const signal = new AbortController().signal;
    await createVideoGenerationTask({ ...config(), videoMode: "reference" }, "", [imageRef], { signal });
    expect(post.mock.calls[0][0]).toBe("http://127.0.0.1:23210/https://example.com/api/v3/contents/generations/tasks");
    expect(post.mock.calls[0][2]?.signal).toBe(signal);
    expect(post.mock.calls[0][1]).toHaveProperty("content.0.image_url.url", "asset://image");
    const controller = new AbortController();
    controller.abort();
    await expect(waitForVideoGenerationTask(config(), { id: "saved", model: config().model, provider: "ark" }, { signal: controller.signal })).rejects.toThrow("Aborted");
    expect(get).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
});

test("local data images require audit identity while fetched audio still becomes a data URL", async () => {
    const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Blob(["wav"], { type: "audio/wav" })));
    const originalReader = globalThis.FileReader;
    Object.defineProperty(globalThis, "FileReader", { configurable: true, writable: true, value: class {
        result = ""; onload?: () => void;
        async readAsDataURL(file: Blob) { this.result = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`; this.onload?.(); }
    } });
    try {
        await expect(createVideoGenerationTask({ ...config(), videoMode: "reference" }, "", [{ ...imageRef, url: "", dataUrl: "data:image/png;base64,AAAA" }])).rejects.toThrow("缺少可持久识别的来源");
        expect(post).not.toHaveBeenCalled();
        await createVideoGenerationTask({ ...config(), videoMode: "reference" }, "", [imageRef], { audios: [{ ...audioRef, url: "blob:local-audio" }] });
        expect(post.mock.calls[0][1]).toHaveProperty("content.0.image_url.url", "asset://image");
        expect(post.mock.calls[0][1]).toHaveProperty("content.1.audio_url.url", "data:audio/wav;base64,d2F2");
    } finally { fetchMock.mockRestore(); Object.defineProperty(globalThis, "FileReader", { configurable: true, writable: true, value: originalReader }); }
});

test("preserves script precedence and 4k/smart parameters", async () => {
    const input = config("custom-video");
    input.channels[0].models[0].script = 'if (params.seconds !== "-1" || params.resolution !== "4k") throw new Error("bad params"); return "https://example.com/script.mp4";';
    expect((await createVideoGenerationTask(input, "海浪")).provider).toBe("plugin");
    expect(post).not.toHaveBeenCalled();
});

test.each(["openai", "gemini"] as const)("preserves %s task creation", async (apiFormat) => {
    const input = { ...config("video-model"), vquality: "720", size: "1280x720", videoSeconds: "6", videoMode: "frames" };
    input.channels[0].apiFormat = apiFormat;
    post.mockResolvedValue({ data: apiFormat === "gemini" ? { name: "operations/1" } : { id: "1" } });
    expect((await createVideoGenerationTask(input, "海浪")).provider).toBe(apiFormat);
    if (apiFormat === "openai") expect(post.mock.calls[0][1]).toBeInstanceOf(FormData);
    else expect(post.mock.calls[0][1]).toHaveProperty("instances.0.prompt", "海浪");
});
