import "./browser-storage";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import axios from "axios";
import { createArkAssetGroup, listArkAssetGroups } from "../src/services/api/ark/assets";
import { defaultConfig, useConfigStore } from "../src/stores/use-config-store";

const config = { accessKeyId: "test-ak", secretAccessKey: "test-sk", projectName: "my-project", groupId: "" };
let post: ReturnType<typeof spyOn<typeof axios, "post">>;
beforeEach(() => { post = spyOn(axios, "post").mockResolvedValue({ data: { Result: { Items: [] } } }); });
afterEach(() => { post.mockRestore(); useConfigStore.setState({ config: defaultConfig }); });

test("creates an AIGC group in the selected project with a signed request and uses the returned ID", async () => {
    post.mockResolvedValue({ data: { Result: { Id: "group-20260921120000-abcde" } } });
    const controller = new AbortController();
    expect(await createArkAssetGroup(config, { name: " 测试组 ", description: " 描述 " }, { signal: controller.signal })).toEqual({ Id: "group-20260921120000-abcde" });
    const [url, data, options] = post.mock.calls[0];
    expect(url).toBe("https://ark.cn-beijing.volcengineapi.com/?Action=CreateAssetGroup&Version=2024-01-01");
    expect(JSON.parse(data as string)).toEqual({ Name: "测试组", Description: "描述", GroupType: "AIGC", ProjectName: "my-project" });
    expect(options?.headers?.Authorization).toContain("HMAC-SHA256");
    expect(options?.signal).toBe(controller.signal);
    expect(post).toHaveBeenCalledTimes(1);
});

test("creation omits blank description, defaults the project and rejects an empty name before HTTP", async () => {
    await expect(createArkAssetGroup(config, { name: " " })).rejects.toThrow("名称");
    expect(post).not.toHaveBeenCalled();
    post.mockResolvedValue({ data: { Result: { Id: "group-20260921120000-abcde" } } });
    await createArkAssetGroup({ ...config, projectName: "" }, { name: "测试组", description: " " });
    expect(JSON.parse(post.mock.calls[0][1] as string)).toEqual({ Name: "测试组", GroupType: "AIGC", ProjectName: "default" });
});

test("creation reports authorization and missing-ID errors without retrying the mutation", async () => {
    post.mockResolvedValue({ data: { ResponseMetadata: { Error: { Code: "AccessDenied", Message: "请签署授权函" } } } });
    await expect(createArkAssetGroup(config, { name: "测试组" })).rejects.toThrow("AccessDenied: 请签署授权函");
    expect(post).toHaveBeenCalledTimes(1);
    post.mockResolvedValue({ data: { Result: {} } });
    await expect(createArkAssetGroup(config, { name: "测试组" })).rejects.toThrow("素材组 ID");
    expect(post).toHaveBeenCalledTimes(2);
});

test("lists both asset group types with project-scoped signed requests and follows every cursor", async () => {
    post.mockImplementation(async (_url, data) => {
        const body = JSON.parse(data as string);
        const type = body.Filter.GroupType;
        const secondPage = Boolean(body.NextToken);
        return { data: { Result: {
            Items: [{ Id: type + (secondPage ? "-2" : "-1"), Name: type, GroupType: type, ProjectName: body.ProjectName }],
            ...(!secondPage && type === "AIGC" ? { NextToken: "unchanged/cursor+=" } : {}),
        } } };
    });
    const groups = await listArkAssetGroups(config);
    expect(groups.map((group) => group.Id)).toEqual(["AIGC-1", "AIGC-2", "LivenessFace-1"]);
    expect(post).toHaveBeenCalledTimes(3);
    for (const [url, data, options] of post.mock.calls) {
        expect(url).toBe("https://ark.cn-beijing.volcengineapi.com/?Action=ListAssetGroups&Version=2024-01-01");
        const body = JSON.parse(data as string);
        expect(body.ProjectName).toBe("my-project");
        expect(body).not.toHaveProperty("GroupId");
        expect(body).not.toHaveProperty("PageNumber");
        expect(body).not.toHaveProperty("MaxResults");
        expect(options?.headers?.Authorization).toContain("HMAC-SHA256");
        expect(options?.headers).not.toHaveProperty("Host");
    }
    expect(post.mock.calls.map(([, data]) => JSON.parse(data as string)).find((body) => body.NextToken)?.NextToken).toBe("unchanged/cursor+=");
});

test("uses the default project and returns an empty list without requiring an existing group ID", async () => {
    expect(await listArkAssetGroups({ ...config, projectName: " " })).toEqual([]);
    expect(JSON.parse(post.mock.calls[0][1] as string).ProjectName).toBe("default");
});

test("rejects missing credentials before HTTP", async () => {
    await expect(listArkAssetGroups({ ...config, secretAccessKey: "" })).rejects.toThrow("Access Key");
    expect(post).not.toHaveBeenCalled();
});

test("reports upstream permission errors instead of pretending that no groups exist", async () => {
    post.mockResolvedValue({ data: { ResponseMetadata: { Error: { Code: "AccessDenied", Message: "no permission" } } } });
    await expect(listArkAssetGroups(config)).rejects.toThrow("AccessDenied: no permission");
});

test("keeps the configured proxy and abort signal on list requests and stops before the next page", async () => {
    useConfigStore.setState({ config: { ...defaultConfig, proxyEnabled: true } });
    const controller = new AbortController();
    post.mockImplementation(async () => {
        controller.abort();
        return { data: { Result: { Items: [], NextToken: "next" } } };
    });
    await expect(listArkAssetGroups(config, { signal: controller.signal })).rejects.toThrow();
    expect(post.mock.calls.every(([url, , options]) => String(url).startsWith("http://127.0.0.1:23210/") && options?.signal === controller.signal)).toBe(true);
    expect(post.mock.calls.every(([, data]) => !JSON.parse(data as string).NextToken)).toBe(true);
});
