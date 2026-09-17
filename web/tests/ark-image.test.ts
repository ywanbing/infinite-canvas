import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import axios from "axios";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
Object.defineProperty(globalThis, "window", { value: { localStorage } });
const { createModelChannel, defaultConfig, resolveModelRequestConfig, useConfigStore } = await import("../src/stores/use-config-store");
const { requestGeneration, requestEdit } = await import("../src/services/api/image");

function config(apiFormat: "ark" | "openai" = "ark") {
    return {
        ...defaultConfig,
        model: "ark-test::doubao-seedream-5.0-pro",
        size: "1024x1024",
        channels: [createModelChannel({ id: "ark-test", apiFormat, baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3", apiKey: "test-key", models: [{ name: "doubao-seedream-5.0-pro", capability: "image" }] })],
    };
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
        expect(body).toEqual({ model: "doubao-seedream-5.0-pro", prompt: "a poster", size: "1024x1024", watermark: false, response_format: "b64_json" });
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
