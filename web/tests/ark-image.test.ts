import "./browser-storage";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import axios from "axios";

const { createModelChannel, defaultConfig, resolveModelRequestConfig, useConfigStore } = await import("../src/stores/use-config-store");
const { requestGeneration, requestEdit } = await import("../src/services/api/image");
const { computeModelImageSize, getImageModelConfig, imageModelConfigs, modelImageSizeError, readModelImageSize, resolveArkImageModelId, resolveModelImageSize } = await import("../src/lib/image-model-config");

function config(apiFormat: "ark" | "openai" = "ark") {
    return {
        ...defaultConfig,
        model: "ark-test::doubao-seedream-5.0-pro",
        size: "1024x1024",
        channels: [createModelChannel({ id: "ark-test", apiFormat, baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3", apiKey: "test-key", models: [{ name: "doubao-seedream-5.0-pro", capability: "image" }] })],
    };
}

function modelConfig(model: string, size: string) {
    const input = config();
    input.model = `ark-test::${model}`;
    input.channels[0].models[0].name = model;
    input.size = size;
    return input;
}

let post: ReturnType<typeof spyOn<typeof axios, "post">>;
beforeEach(() => {
    post = spyOn(axios, "post").mockResolvedValue({ data: { data: [{ url: "https://example.com/image.png" }] } });
});
afterEach(() => {
    post.mockRestore();
    useConfigStore.setState({ config: defaultConfig });
});

describe("Ark image requests", () => {
    test("every model preset is accepted and displays its matching resolution and ratio", () => {
        for (const profile of imageModelConfigs) {
            for (const [scale, ratios] of Object.entries(profile.presets)) {
                for (const [ratio, size] of Object.entries(ratios)) {
                    expect(resolveModelImageSize(profile, size)).toBe(size);
                    expect(readModelImageSize(profile, size)).toMatchObject({ scale, ratio });
                }
            }
        }
    });

    test("keeps automatic ratios and uses each model's documented selection presets", () => {
        const lite = getImageModelConfig("ark", "doubao-seedream-5.0-lite")!;
        const pro = getImageModelConfig("ark", "doubao-seedream-5.0-pro")!;
        expect(computeModelImageSize(lite, "3k", "16:9")).toBe("4096x2304");
        expect(readModelImageSize(lite, "4096x2304")).toMatchObject({ scale: "3k", ratio: "16:9", width: 4096, height: 2304 });
        expect(computeModelImageSize(lite, "3k", "auto")).toBe("3K");
        expect(readModelImageSize(lite, "3K")).toMatchObject({ scale: "3k", ratio: "auto" });
        expect(computeModelImageSize(pro, "1.5k", "4:3")).toBe("1792x1344");
        expect(readModelImageSize(lite, "1:1")).toMatchObject({ width: 2048, height: 2048 });
        expect(readModelImageSize(pro, "4096x2304")).toMatchObject({ scale: "custom", width: 4096, height: 2304 });
        expect(modelImageSizeError(pro, "4096x2304")).not.toBe("");
    });

    test("does not apply Ark rules to other protocols or unknown models", () => {
        expect(getImageModelConfig("openai", "doubao-seedream-5.0-lite")).toBeUndefined();
        expect(getImageModelConfig("ark", "unknown-model")).toBeUndefined();
    });

    test("maps Seedream display names to the official Ark model IDs", () => {
        expect(resolveArkImageModelId("Doubao-Seedream-5.0-pro")).toBe("doubao-seedream-5-0-pro-260628");
        expect(resolveArkImageModelId("doubao-seedream-5-0-260128")).toBe("doubao-seedream-5-0-260128");
        expect(getImageModelConfig("ark", "Doubao-Seedream-5.0-pro")?.name).toBe("Seedream 5.0 pro");
        expect(getImageModelConfig("ark", "doubao-seedream-5-0-260128")?.name).toBe("Seedream 5.0 lite");
        expect(getImageModelConfig("ark", "doubao-seedream-4-5-251128")?.name).toBe("Seedream 4.5");
    });

    test("selecting a resolution after switching models uses the standard ratio preset", () => {
        const pro = getImageModelConfig("ark", "doubao-seedream-5.0-pro")!;
        const lite = getImageModelConfig("ark", "doubao-seedream-5.0-lite")!;
        const previousLiteSize = readModelImageSize(pro, "4096x2304");
        expect(computeModelImageSize(pro, "2k", previousLiteSize.ratio)).toBe("2816x1584");
        expect(computeModelImageSize(pro, "2k", readModelImageSize(pro, "2848x1600").ratio)).toBe("2816x1584");
        const genericSize = readModelImageSize(lite, "2048x1152");
        expect(computeModelImageSize(lite, "2k", genericSize.ratio)).toBe("2848x1600");
        expect(computeModelImageSize(pro, "1k", "21:9")).toBe("1568x672");
    });

    test.each([
        ["doubao-seedream-5.0-lite", "1:1", "2048x2048"],
        ["doubao-seedream-5.0-lite", "16:9", "2848x1600"],
        ["doubao-seedream-5.0-lite", "3K", "3K"],
        ["doubao-seedream-5.0-lite", "5504x3040", "5504x3040"],
        ["doubao-seedream-5.0-lite", "3750x1250", "3750x1250"],
        ["doubao-seedream-5.0-lite", "8192x1024", "8192x1024"],
        ["doubao-seedream-5.0-lite", "auto", "2K"],
        ["doubao-seedream-5.0-pro", "1.5K", "1.5K"],
        ["doubao-seedream-5.0-pro", "16:9", "2816x1584"],
        ["doubao-seedream-4-5-251128", "4096x4096", "4096x4096"],
        ["doubao-seedream-4-0-250828", "1280x720", "1280x720"],
    ])("sends the supported size for %s / %s", async (model, size, expected) => {
        await requestGeneration(modelConfig(model, size), "a poster");
        expect(post.mock.calls[0][1]).toHaveProperty("size", expected);
    });

    test.each([
        ["doubao-seedream-5.0-lite", "1024x1024"],
        ["doubao-seedream-5.0-lite", "2048x1152"],
        ["doubao-seedream-5.0-lite", "5000x5000"],
        ["doubao-seedream-5.0-lite", "10000x500"],
        ["doubao-seedream-5.0-pro", "2880x2880"],
        ["doubao-seedream-4.5", "3K"],
    ])("rejects invalid %s / %s before sending a request", async (model, size) => {
        await expect(requestGeneration(modelConfig(model, size), "a poster")).rejects.toThrow();
        expect(post).not.toHaveBeenCalled();
    });

    test("uses the same model size rules for reference-image editing", async () => {
        await requestEdit(modelConfig("doubao-seedream-5.0-lite", "16:9"), "a poster", [{ id: "ref", dataUrl: "data:image/png;base64,aW1hZ2U=" }]);
        expect(post.mock.calls[0][1]).toHaveProperty("size", "2848x1600");
    });

    test("passes model resolution sizes to custom image scripts", async () => {
        const input = modelConfig("doubao-seedream-5.0-lite", "3K");
        input.channels[0].models[0].script = 'return ["https://example.com/" + params.size + ".png"];';
        expect((await requestGeneration(input, "a poster"))[0].dataUrl).toBe("https://example.com/3K.png");
        expect((await requestEdit(input, "edit", []))[0].dataUrl).toBe("https://example.com/3K.png");
        expect(post).not.toHaveBeenCalled();
    });

    test("keeps the protocol and image options when persisted state is rehydrated", async () => {
        const input = config();
        input.channels[0].arkImageOptions = { watermark: true, outputFormat: "png", promptMode: "standard" };
        useConfigStore.setState({ config: input });
        await useConfigStore.persist.rehydrate();
        expect(useConfigStore.getState().config.channels[0]).toMatchObject(input.channels[0]);
        expect(createModelChannel({ apiFormat: "ark" }).baseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
    });

    test("preserves the Ark channel and sends watermark false without OpenAI-only fields", async () => {
        const input = config();
        expect(input.channels[0].apiFormat).toBe("ark");
        await requestGeneration(input, "a poster");
        const [url, body] = post.mock.calls[0];
        expect(url).toBe("https://ark.cn-beijing.volces.com/api/plan/v3/images/generations");
        expect(body).toEqual({ model: "doubao-seedream-5-0-pro-260628", prompt: "a poster", size: "1024x1024", watermark: false, response_format: "b64_json" });
    });

    test("sends selected channel options at the top level and decodes JPEG responses", async () => {
        const input = config();
        input.channels[0].arkImageOptions = { watermark: true, outputFormat: "jpeg", promptMode: "fast" };
        expect(resolveModelRequestConfig(input, input.model).arkImageOptions).toEqual(input.channels[0].arkImageOptions);
        post.mockResolvedValueOnce({ data: { data: [{ b64_json: "jpeg-data", output_format: "jpeg" }] } });
        const images = await requestGeneration(input, "a poster");
        expect(post.mock.calls[0][1]).toMatchObject({ watermark: true, output_format: "jpeg", optimize_prompt_options: { mode: "fast" } });
        expect(images[0].dataUrl).toBe("data:image/jpeg;base64,jpeg-data");
    });

    test("edits with JSON references on the generation endpoint and carries cancellation through the proxy", async () => {
        const input = config();
        const signal = new AbortController().signal;
        useConfigStore.setState({ config: { ...defaultConfig, proxyEnabled: true } });
        const reference = { id: "reference", dataUrl: "data:image/png;base64,aW1hZ2U=" };
        await requestEdit(input, "change the color", [reference], { signal });
        const [url, body, options] = post.mock.calls[0];
        expect(url).toBe("http://127.0.0.1:23210/https://ark.cn-beijing.volces.com/api/plan/v3/images/generations");
        expect(body).toMatchObject({ image: [reference.dataUrl], watermark: false });
        expect(body).not.toBeInstanceOf(FormData);
        expect(options?.signal).toBe(signal);
    });

    test("generates the requested number without sending unsupported n", async () => {
        const images = await requestGeneration({ ...config(), count: "2" }, "a poster");
        expect(post).toHaveBeenCalledTimes(2);
        expect(images).toHaveLength(2);
        expect(post.mock.calls.every(([, body]) => !("n" in body))).toBe(true);
    });

    test("uses the Ark default JPEG MIME when the response omits output_format", async () => {
        post.mockResolvedValueOnce({ data: { data: [{ b64_json: "jpeg-data" }] } });
        expect((await requestGeneration(config(), "a poster"))[0].dataUrl).toBe("data:image/jpeg;base64,jpeg-data");
    });

    test("uses PNG MIME when explicitly selected and the response omits output_format", async () => {
        const input = config();
        input.channels[0].arkImageOptions = { watermark: false, outputFormat: "png", promptMode: "auto" };
        post.mockResolvedValueOnce({ data: { data: [{ b64_json: "png-data" }] } });
        expect((await requestGeneration(input, "a poster"))[0].dataUrl).toBe("data:image/png;base64,png-data");
    });

    test("preserves custom script precedence", async () => {
        const input = config();
        input.channels[0].models[0].script = 'return ["https://example.com/script.png"];';
        expect((await requestGeneration(input, "a poster"))[0].dataUrl).toBe("https://example.com/script.png");
        expect(post).not.toHaveBeenCalled();
    });

    test("surfaces upstream failures", async () => {
        post.mockRejectedValueOnce(new Error("Ark rejected this request"));
        await expect(requestGeneration(config(), "a poster")).rejects.toThrow("Ark rejected this request");
    });

    test("does not send Ark parameters to OpenAI channels", async () => {
        const input = config("openai");
        input.channels[0].arkImageOptions = { watermark: false, outputFormat: "jpeg", promptMode: "fast" };
        await requestGeneration(input, "a poster");
        expect(post.mock.calls[0][1]).toMatchObject({ n: 1, output_format: "png" });
        expect(post.mock.calls[0][1]).not.toHaveProperty("watermark");
        expect(post.mock.calls[0][1]).not.toHaveProperty("optimize_prompt_options");
    });
});
