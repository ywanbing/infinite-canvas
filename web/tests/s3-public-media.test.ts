import "./browser-storage";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";

const { defaultConfig, useConfigStore } = await import("../src/stores/use-config-store");
const { uploadPublicMedia, validatePublicMediaStorage } = await import("../src/services/api/s3/media");

const settings = {
    enabled: true, provider: "qiniu" as const, accessKey: "test-ak", secretKey: "test-sk", bucket: "media-bucket", forcePathStyle: false,
    region: "cn-south-1", endpoint: "https://media-bucket.s3.cn-south-1.qiniucs.com", publicBaseUrl: "https://cdn.example.com/assets/base/",
};
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

beforeEach(() => {
    useConfigStore.setState({ config: defaultConfig, objectStorage: settings });
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { headers: { etag: '"media-etag"' } }));
});

afterEach(() => fetchSpy.mockRestore());

test("validates enabled credentials and a safe public HTTP base URL before upload", () => {
    for (const [override, message] of [
        [{ enabled: false }, "启用对象存储"], [{ accessKey: "" }, "Access Key"], [{ publicBaseUrl: "" }, "公网访问地址"],
        [{ publicBaseUrl: "ftp://cdn.example.com" }, "HTTP"], [{ publicBaseUrl: "https://user@cdn.example.com" }, "用户名或密码"],
        [{ publicBaseUrl: "https://cdn.example.com?a=1" }, "查询参数"], [{ publicBaseUrl: "https://cdn.example.com/#part" }, "片段"],
    ] as const) {
        useConfigStore.setState({ objectStorage: { ...settings, ...override } });
        expect(validatePublicMediaStorage).toThrow(message);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
});

test("uploads image bytes under a unique MIME extension and returns an encoded public URL", async () => {
    const result = await uploadPublicMedia(new Blob(["image"], { type: "image/jpeg" }), "image");
    const [input, init] = fetchSpy.mock.calls[0];
    const request = input instanceof Request ? input : new Request(input, init);
    expect(result.key).toMatch(/^public\/image\/[A-Za-z0-9_-]+\.jpg$/);
    expect(result.url).toBe(`https://cdn.example.com/assets/base/${result.key.split("/").map(encodeURIComponent).join("/")}`);
    expect(request.method).toBe("PUT");
    expect(request.headers.get("content-type")).toBe("image/jpeg");
});

test("uses the initial config snapshot for both upload and URL when settings change while awaiting", async () => {
    let release!: (response: Response) => void;
    fetchSpy.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const pending = uploadPublicMedia(new Blob(["video"], { type: "video/mp4" }), "video");
    while (!fetchSpy.mock.calls.length) await Bun.sleep(0);
    useConfigStore.setState({ objectStorage: { ...settings, endpoint: "https://other-bucket.example.com", publicBaseUrl: "https://other.example.com" } });
    release(new Response(null));
    const result = await pending;
    const [input, init] = fetchSpy.mock.calls[0];
    const request = input instanceof Request ? input : new Request(input, init);
    expect(new URL(request.url).origin).toBe("https://media-bucket.s3.cn-south-1.qiniucs.com");
    expect(result.key).toMatch(/^public\/video\/[A-Za-z0-9_-]+\.mp4$/);
    expect(result.url.startsWith("https://cdn.example.com/assets/base/")).toBe(true);
});
