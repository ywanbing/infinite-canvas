import axios from "axios";
import type { ArkAssetConfig } from "@/lib/ark-channel-config";
import { withLocalProxy } from "@/stores/use-config-store";
import { readAxiosError } from "../request-utils";

type ArkAssetError = { Code?: string; Message?: string };
type ArkAssetResponse<T> = { Result?: T; ResponseMetadata?: { Error?: ArkAssetError } };
export type ArkAsset = { Id: string; Status: "Processing" | "Active" | "Failed"; Error?: ArkAssetError };
export type ArkAssetGroup = { Id: string; Name: string; GroupType: "AIGC" | "LivenessFace"; ProjectName?: string };
type ArkAssetGroupsResult = { Items?: ArkAssetGroup[]; NextToken?: string };

// https://www.volcengine.com/docs/82379/2318271 (CreateAsset) and /2318274 (GetAsset).
async function assetRequest<T>(config: ArkAssetConfig, action: "CreateAsset" | "GetAsset" | "ListAssetGroups" | "CreateAssetGroup", body: Record<string, unknown>, options?: { signal?: AbortSignal }) {
    if (!config.accessKeyId.trim() || !config.secretAccessKey.trim()) throw new Error("请在火山渠道中配置素材审核的 Access Key ID 和 Secret Access Key。");
    const { default: Signer } = await import("@volcengine/openapi/lib/base/sign");
    const url = new URL("https://ark.cn-beijing.volcengineapi.com/");
    const params = { Action: action, Version: "2024-01-01" };
    url.search = new URLSearchParams(params).toString();
    const data = JSON.stringify({ ...body, ProjectName: config.projectName.trim() || "default" });
    const headers: Record<string, string> = { Host: url.host, "Content-Type": "application/json" };
    new Signer({ region: "cn-beijing", method: "POST", pathname: "/", params, headers, body: data }, "ark")
        .addAuthorization({ accessKeyId: config.accessKeyId.trim(), secretKey: config.secretAccessKey.trim() });
    // The browser (or local proxy) supplies Host; the signature uses the official upstream host.
    delete headers.Host;
    try {
        const response = await axios.post<ArkAssetResponse<T>>(withLocalProxy(url.toString()), data, { headers, signal: options?.signal });
        const error = response.data.ResponseMetadata?.Error;
        if (error) throw new Error([error.Code, error.Message].filter(Boolean).join(": "));
        if (!response.data.Result) throw new Error("火山素材接口未返回结果。");
        return response.data.Result;
    } catch (error) {
        const detail = axios.isAxiosError<ArkAssetResponse<T>>(error) ? error.response?.data.ResponseMetadata?.Error : undefined;
        throw new Error(detail ? [detail.Code, detail.Message].filter(Boolean).join(": ") : readAxiosError(error, "火山素材请求失败"));
    }
}

export function createArkAsset(config: ArkAssetConfig, url: string, name: string, assetType: "Image" | "Video", options?: { signal?: AbortSignal }) {
    if (!config.groupId.trim()) throw new Error("请先在火山渠道中配置素材组 ID。");
    let source: URL;
    try { source = new URL(url.trim()); } catch { throw new Error("素材审核需要有效的公网 HTTP(S) 图片地址。"); }
    if (!["http:", "https:"].includes(source.protocol)) throw new Error("火山素材审核仅支持公网 HTTP(S) 地址，不支持本地文件或 Base64。");
    return assetRequest<{ Id: string }>(config, "CreateAsset", { GroupId: config.groupId.trim(), URL: source.toString(), Name: name, AssetType: assetType }, options);
}

export function getArkAsset(config: ArkAssetConfig, assetId: string, options?: { signal?: AbortSignal }) {
    return assetRequest<ArkAsset>(config, "GetAsset", { Id: assetId }, options);
}

// https://www.volcengine.com/docs/82379/2318270 — creation currently only supports AIGC.
export async function createArkAssetGroup(config: ArkAssetConfig, input: { name: string; description?: string }, options?: { signal?: AbortSignal }) {
    const name = input.name.trim();
    const description = input.description?.trim();
    if (!name) throw new Error("请输入素材组名称。");
    const result = await assetRequest<{ Id: string }>(config, "CreateAssetGroup", {
        Name: name, GroupType: "AIGC", ...(description ? { Description: description } : {}),
    }, options);
    if (!result.Id) throw new Error("火山未返回素材组 ID，请刷新列表确认创建结果后再重试。");
    return result;
}

export async function listArkAssetGroups(config: ArkAssetConfig, options?: { signal?: AbortSignal }) {
    const pages = await Promise.all((["AIGC", "LivenessFace"] as const).map(async (groupType) => {
        const groups: ArkAssetGroup[] = [];
        let nextToken: string | undefined;
        do {
            options?.signal?.throwIfAborted();
            const result = await assetRequest<ArkAssetGroupsResult>(config, "ListAssetGroups", {
                Filter: { GroupType: groupType },
                ...(nextToken ? { NextToken: nextToken } : {}),
            }, options);
            groups.push(...(result.Items || []));
            nextToken = result.NextToken || undefined;
        } while (nextToken);
        return groups;
    }));
    return pages.flat();
}

export const createArkImageAsset = (config: ArkAssetConfig, url: string, name: string, options?: { signal?: AbortSignal }) => createArkAsset(config, url, name, "Image", options);
export const getArkImageAsset = getArkAsset;
