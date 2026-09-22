import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { isArkMediaExempt, isPublicMediaUrl, mediaReferenceKey, mediaReferenceSource } from "@/lib/media-reference";
import { createArkAsset, getArkAsset } from "@/services/api/ark/assets";
import { createKexiangAsset, queryKexiangAsset } from "@/services/api/kexiang/assets";
import { uploadPublicMedia, validatePublicMediaStorage } from "@/services/api/s3/media";
import { findMediaReferenceRecords, getMediaReferenceRecord, runMediaReferenceWork, saveMediaReferenceRecord, setMediaReferenceProgress, useMediaReferenceStore, type MediaReferenceRecord } from "@/stores/use-media-reference-store";
import { resolveModelChannel, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { MediaReferenceInput } from "@/types/media-reference";

export type PrepareMediaReferenceOptions = {
    signal?: AbortSignal;
    onProgress?: (message: string) => void;
    forceAudit?: boolean;
    supportsAssets?: boolean;
};

export async function mediaReferenceScope(config: AiConfig, kind: "image" | "video") {
    const channel = resolveModelChannel(config, config.model);
    const request = resolveModelRequestConfig(config, config.model);
    const provider = request.apiFormat;
    if (provider !== "ark" && provider !== "kexiang") throw new Error("当前渠道不支持 Seedance 素材准备。");
    const credentials = provider === "ark"
        ? [channel.arkAssets?.accessKeyId, channel.arkAssets?.secretAccessKey]
        : [request.apiKey];
    const fingerprint = await credentialFingerprint(credentials.filter(Boolean).join("\n"));
    return JSON.stringify({
        provider,
        channelId: channel.id,
        baseUrl: request.baseUrl.trim().replace(/\/+$/, ""),
        credential: fingerprint,
        project: provider === "ark" ? channel.arkAssets?.projectName.trim() || "default" : undefined,
        group: provider === "ark" ? channel.arkAssets?.groupId.trim() : undefined,
        kind,
    });
}

export async function prepareMediaReference(config: AiConfig, item: MediaReferenceInput, kind: "image" | "video", options?: PrepareMediaReferenceOptions): Promise<string> {
    throwIfAborted(options?.signal);
    await useMediaReferenceStore.getState().load();
    const identity = mediaReferenceKey(item);
    const scope = await mediaReferenceScope(config, kind);
    const operationKey = JSON.stringify([identity, scope]);
    return runMediaReferenceWork(operationKey, () => prepare(config, item, kind, identity, scope, operationKey, options), options?.signal);
}

async function prepare(config: AiConfig, item: MediaReferenceInput, kind: "image" | "video", identity: string, scope: string, operationKey: string, options?: PrepareMediaReferenceOptions) {
    const channel = resolveModelChannel(config, config.model);
    const request = resolveModelRequestConfig(config, config.model);
    const provider = request.apiFormat as "ark" | "kexiang";
    const originalSource = mediaReferenceSource(item).trim();
    const progress = (message: string) => {
        setMediaReferenceProgress(operationKey, message);
        options?.onProgress?.(message);
    };
    throwIfAborted(options?.signal);

    const bareAssetId = originalSource.match(/^asset:\/\/(.+)$/i)?.[1];
    if (options?.supportsAssets === false && bareAssetId) throw new Error("当前火山模型不支持 asset:// 素材。");
    if (bareAssetId) {
        const records = findMediaReferenceRecords(item);
        const current = records.find((record) => record.scope === scope);
        if (current?.status === "active" && current.assetId === bareAssetId) return checkedReturn(originalSource, options?.signal);
        if (records.some((record) => record.scope !== scope && record.status === "active")) throw new Error("这个 asset:// 素材已绑定其他渠道或凭据，不能在当前渠道复用。");
        await saveMediaReferenceRecord({ identity, scope, provider, kind, source: originalSource, status: "active", assetId: bareAssetId });
        return checkedReturn(originalSource, options?.signal);
    }

    const record = getMediaReferenceRecord(item, scope);
    if (record?.status === "active" && record.assetId) {
        if (options?.supportsAssets === false) throw new Error("当前火山模型不支持 asset:// 素材。");
        return checkedReturn(`asset://${record.assetId}`, options?.signal);
    }
    const trusted = isArkMediaExempt(item) && !options?.forceAudit;
    if (trusted && record?.status === "active" && record.exemptUntil && record.exemptUntil > Date.now() && (!record.publicUrlExpiresAt || record.publicUrlExpiresAt > Date.now())) {
        return checkedReturn(record.publicUrl || record.source, options?.signal);
    }

    if (trusted) {
        try {
            const publicSource = await resolvePublicSource(item, kind, record, options, progress);
            const generatedAt = item.mediaSource!.generatedAt!;
            await saveMediaReferenceRecord({ identity, scope, provider, kind, source: originalSource, publicUrl: publicSource.url, publicStorageKey: publicSource.key, publicUrlExpiresAt: publicSource.key ? undefined : item.mediaSource?.urlExpiresAt ?? item.urlExpiresAt, exemptUntil: generatedAt + 30 * 24 * 60 * 60 * 1000, status: "active" });
            return checkedReturn(publicSource.url, options?.signal);
        } finally {
            setMediaReferenceProgress(operationKey);
        }
    }
    if (options?.supportsAssets === false) throw new Error("当前火山模型不支持素材审核，外部来源无法作为参考素材使用。");
    validateAuditConfig(provider, channel, request);

    try {
        if (record?.status === "processing" && (record.arkAssetId || record.kexiangQueryId !== undefined)) {
            progress("正在查询素材审核结果…");
            return await resumeAudit(channel, request, record, item, options);
        }
        const publicSource = await resolvePublicSource(item, kind, record, options, progress);
        if (!record?.publicUrl || record.publicUrl !== publicSource.url) {
            await saveMediaReferenceRecord({ identity, scope, provider, kind, source: originalSource, publicUrl: publicSource.url, publicStorageKey: publicSource.key, publicUrlExpiresAt: publicSource.expiresAt, status: "processing" });
        }
        progress("正在提交素材审核…");
        throwIfAborted(options?.signal);
        if (provider === "ark") {
            if (!channel.arkAssets) throw new Error("请先配置火山渠道的素材审核凭据。");
            const created = await createArkAsset(channel.arkAssets, publicSource.url, item.name || (kind === "image" ? "参考图" : "参考视频"), kind === "image" ? "Image" : "Video", { signal: options?.signal });
            if (!created.Id) throw new Error("火山素材接口未返回素材 ID。");
            await saveMediaReferenceRecord({ identity, scope, provider, kind, source: originalSource, publicUrl: publicSource.url, publicStorageKey: publicSource.key, publicUrlExpiresAt: publicSource.expiresAt, arkAssetId: created.Id, status: "processing" });
            throwIfAborted(options?.signal);
            return await resumeAudit(channel, request, getMediaReferenceRecord(item, scope)!, item, options);
        }
        const created = await createKexiangAsset(request, publicSource.url, item.name || (kind === "image" ? "参考图" : "参考视频"), kind === "image" ? "Image" : "Video", { signal: options?.signal });
        const saved = await saveMediaReferenceRecord({ identity, scope, provider, kind, source: originalSource, publicUrl: publicSource.url, publicStorageKey: publicSource.key, publicUrlExpiresAt: publicSource.expiresAt, kexiangQueryId: created.queryId, assetId: created.assetId, status: created.status === "pending" ? "processing" : created.status, error: created.error });
        throwIfAborted(options?.signal);
        if (saved.status === "failed") throw new Error(saved.error || "素材审核失败，请重试。");
        return await resumeAudit(channel, request, saved, item, options);
    } catch (error) {
        if (!options?.signal?.aborted) {
            const latest = getMediaReferenceRecord(item, scope);
            if (latest) {
                const hasRemoteId = Boolean(latest.arkAssetId) || latest.kexiangQueryId !== undefined;
                await saveMediaReferenceRecord({ ...latest, status: hasRemoteId && latest.status !== "failed" ? "processing" : "failed", error: errorMessage(error) });
            }
        }
        throw error;
    } finally {
        setMediaReferenceProgress(operationKey);
    }
}

async function resumeAudit(channel: ReturnType<typeof resolveModelChannel>, request: AiConfig, record: MediaReferenceRecord, item: MediaReferenceInput, options?: PrepareMediaReferenceOptions) {
    throwIfAborted(options?.signal);
    if (record.provider === "ark") {
        if (!channel.arkAssets || !record.arkAssetId) throw new Error("素材审核记录不完整，请重新提交审核。");
        const result = await getArkAsset(channel.arkAssets, record.arkAssetId, { signal: options?.signal });
        throwIfAborted(options?.signal);
        if (result.Id !== record.arkAssetId) throw new Error("火山素材接口返回了不匹配的素材 ID。");
        if (result.Status === "Processing") throw new Error("素材仍在审核中，请稍后重试。");
        if (result.Status === "Failed") {
            const error = [result.Error?.Code, result.Error?.Message].filter(Boolean).join(": ") || "火山素材审核失败，请重试。";
            await saveMediaReferenceRecord({ ...record, status: "failed", error });
            throw new Error(error);
        }
        if (result.Status !== "Active") throw new Error(`火山素材接口返回了未知状态：${String(result.Status || "空")}`);
        await saveMediaReferenceRecord({ ...record, status: "active", assetId: result.Id, error: undefined });
        return checkedReturn(`asset://${result.Id}`, options?.signal);
    }
    if (record.kexiangQueryId === undefined) throw new Error("素材审核记录不完整，请重新提交审核。");
    const result = await queryKexiangAsset(request, record.kexiangQueryId, { signal: options?.signal });
    throwIfAborted(options?.signal);
    if (result.status === "pending") throw new Error("素材仍在审核中，请稍后重试。");
    if (result.status === "failed") {
        const error = result.error || "素材审核失败，请重试。";
        await saveMediaReferenceRecord({ ...record, status: "failed", error });
        throw new Error(error);
    }
    const assetId = result.assetId || record.assetId;
    if (!assetId) throw new Error(`${item.name || "素材"}审核通过，但接口没有返回 asset_id。`);
    await saveMediaReferenceRecord({ ...record, status: "active", assetId, error: undefined });
    return checkedReturn(result.url?.startsWith("asset://") ? result.url : `asset://${assetId}`, options?.signal);
}

async function resolvePublicSource(item: MediaReferenceInput, kind: "image" | "video", record: MediaReferenceRecord | undefined, options?: PrepareMediaReferenceOptions, onProgress?: (message: string) => void) {
    if (record?.publicUrl && (!record.publicUrlExpiresAt || record.publicUrlExpiresAt > Date.now())) return { url: record.publicUrl, key: record.publicStorageKey, expiresAt: record.publicUrlExpiresAt };
    const shared = findMediaReferenceRecords(item).find((candidate) => candidate.publicUrl && (!candidate.publicUrlExpiresAt || candidate.publicUrlExpiresAt > Date.now()));
    if (shared?.publicUrl) return { url: shared.publicUrl, key: shared.publicStorageKey, expiresAt: shared.publicUrlExpiresAt };
    const source = mediaReferenceSource(item).trim();
    const expiresAt = item.mediaSource?.urlExpiresAt ?? item.urlExpiresAt;
    if (isPublicMediaUrl(source) && (expiresAt === undefined || expiresAt > Date.now())) return { url: source, key: undefined, expiresAt };
    const stored = item.storageKey ? kind === "image" ? await getImageBlob(item.storageKey) : await getMediaBlob(item.storageKey) : null;
    const blob = stored || await sourceBlob(source, options?.signal) || (item.dataUrl !== source ? await sourceBlob(item.dataUrl || "", options?.signal) : null);
    if (!blob) throw new Error("找不到素材原文件，无法生成可供审核的公网地址。");
    throwIfAborted(options?.signal);
    onProgress?.("正在上传公网素材…");
    validatePublicMediaStorage();
    return { ...await uploadPublicMedia(blob, kind, { signal: options?.signal }), expiresAt: undefined };
}

function validateAuditConfig(provider: "ark" | "kexiang", channel: ReturnType<typeof resolveModelChannel>, request: AiConfig) {
    if (provider === "ark") {
        const assets = channel.arkAssets;
        if (!assets?.accessKeyId.trim() || !assets.secretAccessKey.trim() || !assets.groupId.trim()) throw new Error("请先配置完整的火山素材审核凭据和素材组 ID。");
    } else if (!request.apiKey.trim()) {
        throw new Error("请先配置可想渠道的 API Key。");
    }
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "素材审核失败。";
}

async function sourceBlob(source: string, signal?: AbortSignal) {
    if (!/^(?:data:|blob:)/i.test(source)) return null;
    const response = await fetch(source, { signal });
    if (!response.ok) throw new Error("读取本地素材失败。");
    return response.blob();
}

async function credentialFingerprint(value: string) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("请求已取消。", "AbortError");
}

function checkedReturn(value: string, signal?: AbortSignal) {
    throwIfAborted(signal);
    return value;
}
