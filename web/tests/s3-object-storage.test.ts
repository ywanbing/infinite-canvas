import "./browser-storage";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import type { ObjectStorageConfig } from "../src/services/api/s3/config";
import type { S3Provider } from "../src/services/api/s3/types";

const { defaultConfig, useConfigStore } = await import("../src/stores/use-config-store");
const api = await import("../src/services/api/s3");
const { s3Providers } = await import("../src/services/api/s3/config");
const settings = {
    enabled: true, provider: "qiniu" as const, accessKey: "test-ak", secretKey: "test-sk", bucket: "ywb-canvas", forcePathStyle: false,
    region: "cn-south-1" as const, endpoint: "https://ywb-canvas.s3.cn-south-1.qiniucs.com", publicBaseUrl: "https://media.example.com",
};
const listXml = '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>ywb-canvas</Name><IsTruncated>true</IsTruncated><NextContinuationToken>next+=</NextContinuationToken><Contents><Key>图片/a &amp; b.png</Key><Size>12</Size><ETag>"etag"</ETag><LastModified>2026-09-01T00:00:00Z</LastModified></Contents><CommonPrefixes><Prefix>图片/</Prefix></CommonPrefixes></ListBucketResult>';
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

beforeEach(() => {
    useConfigStore.setState({ objectStorage: settings, config: { ...defaultConfig, proxyEnabled: true } });
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => new Response(listXml, { headers: { "content-type": "application/xml" } }));
});
afterEach(() => {
    fetchSpy.mockRestore();
    useConfigStore.setState({ config: defaultConfig, objectStorage: { ...settings, enabled: false, accessKey: "", secretKey: "", bucket: "" } });
});

function calledRequest() {
    const [input, init] = fetchSpy.mock.calls[0];
    return input instanceof Request ? input : new Request(input, init);
}

test("lists directly with S3 v4 authorization and preserves Unicode keys and continuation tokens", async () => {
    const result = await api.listObjects({ prefix: "图片/ +", continuationToken: "abc+=", delimiter: "/" });
    const request = calledRequest();
    const url = new URL(request.url);
    expect(url.origin).toBe("https://ywb-canvas.s3.cn-south-1.qiniucs.com");
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("list-type")).toBe("2");
    expect(url.searchParams.get("prefix")).toBe("图片/ +");
    expect(url.searchParams.get("continuation-token")).toBe("abc+=");
    expect(url.searchParams.get("delimiter")).toBe("/");
    expect(url.searchParams.has("encoding-type")).toBe(false);
    expect(request.method).toBe("GET");
    expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=test-ak\/\d{8}\/cn-south-1\/s3\/aws4_request,/);
    expect(result.items[0]).toEqual({ key: "图片/a & b.png", size: 12, etag: '"etag"', lastModified: "2026-09-01T00:00:00.000Z" });
    expect(result.isTruncated).toBe(true);
    expect(result.nextContinuationToken).toBe("next+=");
    expect(result.commonPrefixes).toEqual(["图片/"]);
});

test("uploads raw bytes through PUT without multipart or unsupported checksum headers", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { headers: { etag: '"upload-etag"' } }));
    const file = new File(["image bytes"], "图.png", { type: "image/png" });
    const result = await api.uploadObject({ file, key: "目录/图 +%?#.png" });
    const request = calledRequest();
    expect(request.method).toBe("PUT");
    expect(new URL(request.url).origin).toBe("https://ywb-canvas.s3.cn-south-1.qiniucs.com");
    expect(decodeURIComponent(new URL(request.url).pathname)).toBe("/目录/图 +%?#.png");
    expect(request.headers.get("content-type")).toBe("image/png");
    expect(request.headers.has("x-amz-sdk-checksum-algorithm")).toBe(false);
    expect(await request.clone().text()).toBe("image bytes");
    expect(result).toEqual({ key: "目录/图 +%?#.png", etag: '"upload-etag"' });
});

test("deletes the exact object name and accepts an empty 204 response", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.deleteObject(" 图/+.png ");
    const request = calledRequest();
    expect(request.method).toBe("DELETE");
    expect(new URL(request.url).origin).toBe("https://ywb-canvas.s3.cn-south-1.qiniucs.com");
    expect(decodeURIComponent(new URL(request.url).pathname)).toBe("/ 图/+.png ");
});

test("copies with an encoded source header and addresses the destination bucket only once", async () => {
    fetchSpy.mockResolvedValueOnce(new Response('<CopyObjectResult><ETag>"copy-etag"</ETag><LastModified>2026-09-01T00:00:00Z</LastModified></CopyObjectResult>'));
    const result = await api.copyObject({ sourceKey: "目录/图 +%.png", destinationKey: "new.png", destinationBucket: "other-bucket" });
    const request = calledRequest();
    expect(request.method).toBe("PUT");
    expect(new URL(request.url).origin).toBe("https://other-bucket.s3.cn-south-1.qiniucs.com");
    expect(new URL(request.url).pathname).toBe("/new.png");
    expect(request.headers.get("x-amz-copy-source")).toBe("/ywb-canvas/%E7%9B%AE%E5%BD%95/%E5%9B%BE%20%2B%25.png");
    expect(result).toEqual({ key: "new.png", etag: '"copy-etag"', lastModified: "2026-09-01T00:00:00.000Z" });
});

test("supports regional service endpoints as well as full bucket endpoints", async () => {
    useConfigStore.setState({ objectStorage: { ...settings, endpoint: " https://s3.cn-south-1.qiniucs.com/ " } });
    await api.listObjects();
    expect(new URL(calledRequest().url).origin).toBe("https://ywb-canvas.s3.cn-south-1.qiniucs.com");
});

test("dispatches all four operations through the selected provider without Qiniu endpoint assumptions", async () => {
    const registry = s3Providers as Record<string, S3Provider>;
    registry.fixture = { ...s3Providers.qiniu, name: "测试存储", regions: [{ value: "test-region", label: "测试区域" }], resolveEndpoint: () => "https://storage.example.com", forcePathStyle: true };
    useConfigStore.setState({ objectStorage: { ...settings, provider: "fixture", region: "test-region" } as unknown as ObjectStorageConfig });
    try {
        await api.listObjects();
        await api.uploadObject({ file: new File(["test"], "a"), key: "a" });
        await api.copyObject({ sourceKey: "a", destinationKey: "b" });
        await api.deleteObject("b");
        const requests = fetchSpy.mock.calls.map(([input, init]) => input instanceof Request ? input : new Request(input, init));
        expect(requests.map((request) => request.method)).toEqual(["GET", "PUT", "PUT", "DELETE"]);
        for (const request of requests) {
            expect(new URL(request.url).origin).toBe("https://storage.example.com");
            expect(new URL(request.url).pathname.startsWith("/ywb-canvas/")).toBe(true);
        }
    } finally {
        delete registry.fixture;
    }
});

test("normalizes an empty object listing without leaking SDK response fields", async () => {
    fetchSpy.mockResolvedValueOnce(new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>'));
    expect(await api.listObjects()).toEqual({ items: [], commonPrefixes: [], isTruncated: false, nextContinuationToken: undefined });
});

test("rejects disabled, incomplete and mismatched settings before sending credentials", async () => {
    for (const override of [{ enabled: false }, { accessKey: "" }, { secretKey: "" }, { bucket: "" }, { endpoint: "https://example.com/path" }, { region: "cn-east-1" }, { bucket: "different-bucket" }, { provider: "unknown" }]) {
        useConfigStore.setState({ objectStorage: { ...settings, ...override } });
        await expect(api.listObjects()).rejects.toThrow();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
});

test("rejects empty object keys without a network request", async () => {
    await expect(api.deleteObject("")).rejects.toThrow();
    await expect(api.copyObject({ sourceKey: "a", destinationKey: "" })).rejects.toThrow();
    await expect(api.uploadObject({ key: "", file: new File(["a"], "a") })).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
});

test("surfaces S3 errors without retrying or using the enabled local proxy", async () => {
    fetchSpy.mockImplementation(async () => new Response('<Error><Code>InternalError</Code><Message>Storage unavailable</Message></Error>', { status: 503 }));
    await expect(api.listObjects()).rejects.toThrow("Storage unavailable");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(new URL(calledRequest().url).host).toBe("ywb-canvas.s3.cn-south-1.qiniucs.com");
});

test("reports a copy error embedded in HTTP 200 as a failure", async () => {
    fetchSpy.mockImplementation(async () => new Response('<Error><Code>InternalError</Code><Message>Copy failed</Message></Error>'));
    await expect(api.copyObject({ sourceKey: "a", destinationKey: "b" })).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("explains CORS failures and preserves cancellation", async () => {
    fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.listObjects()).rejects.toThrow("CORS");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockClear();
    const controller = new AbortController();
    controller.abort();
    await expect(api.listObjects({ signal: controller.signal })).rejects.toHaveProperty("name", "AbortError");
    expect(fetchSpy).not.toHaveBeenCalled();
});

test("persists S3 settings independently of the AI proxy switch", async () => {
    useConfigStore.getState().updateObjectStorageConfig("bucket", "saved-bucket");
    await useConfigStore.persist.rehydrate();
    expect(useConfigStore.getState().objectStorage.bucket).toBe("saved-bucket");
    expect(useConfigStore.getState().objectStorage.endpoint).toBe(settings.endpoint);
    expect(useConfigStore.getState().config.proxyEnabled).toBe(true);
});
