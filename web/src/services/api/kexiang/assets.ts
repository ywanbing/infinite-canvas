import axios from "axios";
import type { AiConfig } from "@/stores/use-config-store";
import { readAxiosError, type RequestOptions } from "../request-utils";
import { kexiangApiUrl, kexiangHeaders } from "./client";

export type KexiangAssetType = "Image" | "Video" | "Audio";
type KexiangAssetPayload = { id?: number | string; asset_id?: string; status?: string; url?: string; error_msg?: string | null; data?: KexiangAssetPayload };

function kexiangAssetData(payload: KexiangAssetPayload) {
    return payload?.data && typeof payload.data === "object" ? payload.data : payload;
}

export type KexiangAssetResult = { queryId: number; assetId?: string; url?: string; status: "pending" | "active" | "failed"; error?: string };

function normalizeAsset(payload: KexiangAssetPayload, expectedQueryId?: number): KexiangAssetResult {
    const data = kexiangAssetData(payload);
    const returnedId = data.id === undefined ? undefined : Number(data.id);
    if (returnedId !== undefined && (!Number.isFinite(returnedId) || expectedQueryId !== undefined && returnedId !== expectedQueryId)) throw new Error("素材审核接口返回了不匹配的查询 ID。");
    const queryId = returnedId ?? expectedQueryId;
    if (queryId === undefined || !Number.isFinite(queryId)) throw new Error("素材审核接口没有返回有效的数字查询 ID。");
    const rawStatus = (data.status || "").toLowerCase();
    const status = ["active", "success", "completed"].includes(rawStatus) ? "active" : ["failed", "error", "rejected"].includes(rawStatus) ? "failed" : ["", "pending", "processing", "created", "queued"].includes(rawStatus) ? "pending" : undefined;
    if (!status) throw new Error(`素材审核接口返回了未知状态：${data.status}`);
    return { queryId, assetId: data.asset_id, url: data.url, status, error: data.error_msg || undefined };
}

export async function createKexiangAsset(config: AiConfig, url: string, name: string, assetType: KexiangAssetType, options?: RequestOptions) {
    try {
        const response = await axios.post<KexiangAssetPayload>(kexiangApiUrl(config, "/ark_asset_api_key/upload"), { url, name, asset_type: assetType, wait_complete: false }, { headers: kexiangHeaders(config, "application/json"), signal: options?.signal });
        return normalizeAsset(response.data);
    } catch (error) {
        throw new Error(readAxiosError(error, `${name} 素材审核创建失败`));
    }
}

export async function queryKexiangAsset(config: AiConfig, queryId: number, options?: RequestOptions) {
    try {
        const response = await axios.get<KexiangAssetPayload>(kexiangApiUrl(config, `/ark_asset_api_key/get/${encodeURIComponent(String(queryId))}`), { headers: kexiangHeaders(config), signal: options?.signal });
        return normalizeAsset(response.data, queryId);
    } catch (error) {
        throw new Error(readAxiosError(error, "素材审核查询失败"));
    }
}

export async function auditKexiangAsset(config: AiConfig, url: string, name: string, assetType: KexiangAssetType, options?: RequestOptions) {
    const source = url.trim();
    const existingAssetId = source.match(/^asset:\/\/(.+)$/i)?.[1];
    if (!existingAssetId && !/^https?:\/\//i.test(source)) throw new Error(`${name} 需要公网 HTTP(S) 地址或 asset:// 素材 ID，才能进行素材审核。`);
    if (existingAssetId) return `asset://${existingAssetId}`;
    try {
        const created = await createKexiangAsset(config, source, name, assetType, options);
        const checked = await queryKexiangAsset(config, created.queryId, options);
        if (checked.status !== "active" || !(checked.assetId || created.assetId)) throw new Error(checked.error || created.error || `${name} 素材尚未审核通过。`);
        const assetId = checked.assetId || created.assetId;
        return checked.url?.startsWith("asset://") ? checked.url : `asset://${assetId}`;
    } catch (error) {
        throw new Error(readAxiosError(error, `${name} 素材审核失败`));
    }
}
