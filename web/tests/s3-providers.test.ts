import "./browser-storage";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { defaultObjectStorageConfig, s3Providers, type ObjectStorageConfig } from "../src/services/api/s3/config";
import { copyObject, deleteObject, listObjects, uploadObject } from "../src/services/api/s3";
import { useConfigStore } from "../src/stores/use-config-store";

const initial = useConfigStore.getState();
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
beforeEach(() => {
    useConfigStore.setState({ config: { ...initial.config, proxyEnabled: true } });
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (request.method === "GET") return new Response("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>");
        if (request.headers.has("x-amz-copy-source")) return new Response('<CopyObjectResult><ETag>"copied"</ETag></CopyObjectResult>');
        return new Response(null, { status: request.method === "DELETE" ? 204 : 200 });
    });
});
afterEach(() => { fetchSpy.mockRestore(); useConfigStore.setState(initial); });

function configure(overrides: Partial<ObjectStorageConfig>) {
    const config = { ...defaultObjectStorageConfig, enabled: true, accessKey: "fixture-ak", secretKey: "fixture-sk", bucket: "test-bucket", ...overrides };
    useConfigStore.setState({ objectStorage: config });
    return config;
}

for (const entry of [
    { provider: "volcengine", region: "cn-beijing", endpoint: "https://test-bucket.tos-s3-cn-beijing.volces.com", forcePathStyle: true, origin: "https://test-bucket.tos-s3-cn-beijing.volces.com", path: "" },
    { provider: "generic", region: "custom-region", endpoint: "http://storage.example.com:9000", forcePathStyle: true, origin: "http://storage.example.com:9000", path: "/test-bucket" },
    { provider: "generic", region: "auto", endpoint: "https://storage.example.com", forcePathStyle: false, origin: "https://test-bucket.storage.example.com", path: "" },
] as const) {
    test(`${entry.provider} ${entry.region} sends all four operations directly with correct addressing and signing`, async () => {
        configure(entry);
        expect((await listObjects()).items).toEqual([]);
        await uploadObject({ file: new File(["test bytes"], "a"), key: "目录/a +.png" });
        expect((await copyObject({ sourceKey: "目录/a +.png", destinationKey: "b.png" })).etag).toBe('"copied"');
        await deleteObject("b.png");
        const requests = fetchSpy.mock.calls.map(([input, init]) => input instanceof Request ? input : new Request(input, init));
        expect(requests.map((r) => r.method)).toEqual(["GET", "PUT", "PUT", "DELETE"]);
        expect(requests.map((r) => decodeURIComponent(new URL(r.url).pathname))).toEqual([`${entry.path}/`, `${entry.path}/目录/a +.png`, `${entry.path}/b.png`, `${entry.path}/b.png`]);
        for (const request of requests) {
            expect(new URL(request.url).origin).toBe(entry.origin);
            expect(request.headers.get("authorization")).toContain(`/${entry.region}/s3/aws4_request`);
            expect(request.redirect).toBe("error");
        }
        expect(await requests[1].clone().text()).toBe("test bytes");
        expect(requests[2].headers.get("x-amz-copy-source")).toBe("/test-bucket/%E7%9B%AE%E5%BD%95/a%20%2B.png");
    });
}

test("TOS accepts every documented regional endpoint and rejects native or mismatched endpoints", async () => {
    for (const { value: region } of s3Providers.volcengine.regions) {
        const config = configure({ provider: "volcengine", region });
        expect(s3Providers.volcengine.resolveEndpoint(config)).toBe(`https://tos-s3-${region}.volces.com`);
    }
    for (const endpoint of ["https://tos-cn-beijing.volces.com", "https://tos-s3-cn-shanghai.volces.com", "https://other.tos-s3-cn-beijing.volces.com", "https://tos-s3-cn-beijing.volces.com/path"]) {
        configure({ provider: "volcengine", region: "cn-beijing", endpoint });
        await expect(listObjects()).rejects.toThrow();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
});

test("generic S3 rejects missing region and malformed endpoints before sending credentials", async () => {
    for (const override of [{ endpoint: "" }, { region: " " }, { endpoint: "ftp://storage.example.com" }, { endpoint: "https://user:pass@storage.example.com" }, { endpoint: "https://storage.example.com?token=x" }, { endpoint: "https://storage.example.com/#part" }, { endpoint: "https://storage.example.com/bucket" }]) {
        configure({ provider: "generic", region: "us-east-1", endpoint: "https://storage.example.com", ...override });
        await expect(listObjects()).rejects.toThrow();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
});

test("switching providers restores each configuration independently across reloads", async () => {
    const qiniu = configure({ endpoint: "https://old.example.com", publicBaseUrl: "https://old-cdn.example.com" });
    useConfigStore.getState().updateObjectStorageConfig("provider", "volcengine");
    expect(useConfigStore.getState().objectStorage).toEqual({ ...defaultObjectStorageConfig, enabled: true, provider: "volcengine", region: "cn-beijing" });
    useConfigStore.getState().updateObjectStorageConfig("accessKey", "tos-fixture-ak");
    useConfigStore.getState().updateObjectStorageConfig("bucket", "tos-bucket");
    const volcengine = useConfigStore.getState().objectStorage;
    useConfigStore.getState().updateObjectStorageConfig("provider", "generic");
    useConfigStore.getState().updateObjectStorageConfig("region", "auto");
    useConfigStore.getState().updateObjectStorageConfig("forcePathStyle", true);
    const { storage, name } = useConfigStore.persist.getOptions();
    const persisted = await storage!.getItem(name);
    useConfigStore.setState({ objectStorage: defaultObjectStorageConfig, objectStorageProfiles: {} });
    await storage!.setItem(name, persisted!);
    await useConfigStore.persist.rehydrate();
    expect(useConfigStore.getState().objectStorage).toMatchObject({ provider: "generic", region: "auto", forcePathStyle: true });
    useConfigStore.getState().updateObjectStorageConfig("provider", "qiniu");
    expect(useConfigStore.getState().objectStorage).toEqual(qiniu);
    useConfigStore.getState().updateObjectStorageConfig("provider", "volcengine");
    expect(useConfigStore.getState().objectStorage).toEqual(volcengine);
    useConfigStore.getState().updateObjectStorageConfig("enabled", false);
    useConfigStore.getState().updateObjectStorageConfig("provider", "generic");
    expect(useConfigStore.getState().objectStorage).toMatchObject({ enabled: false, provider: "generic", region: "auto", forcePathStyle: true });
});
