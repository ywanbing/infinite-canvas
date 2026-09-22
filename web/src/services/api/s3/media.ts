import { nanoid } from "nanoid";

import { useConfigStore } from "@/stores/use-config-store";
import { isObjectStorageConfig, type ObjectStorageConfig } from "./config";
import { uploadObject } from "./index";

export type PublicMediaKind = "image" | "video";
export type PublicMediaUploadOptions = { signal?: AbortSignal };
export type PublicMediaUploadResult = { url: string; key: string };

const extensions: Record<string, string> = {
    "image/avif": "avif", "image/gif": "gif", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-matroska": "mkv",
};

function getPublicMediaConfig(): ObjectStorageConfig {
    const config = { ...useConfigStore.getState().objectStorage };
    if (!isObjectStorageConfig(config)) throw new Error("对象存储配置无效，请重新填写配置。");
    if (!config.enabled) throw new Error("请先启用对象存储。");
    if (!config.accessKey.trim() || !config.secretKey.trim() || !config.bucket.trim()) throw new Error("请填写对象存储 Access Key、Secret Key 和 S3 Bucket。");
    requirePublicBaseUrl(config.publicBaseUrl);
    return config;
}

function requirePublicBaseUrl(value: string) {
    if (!value.trim()) throw new Error("请填写对象存储公网访问地址。");
    let url: URL;
    try { url = new URL(value.trim()); } catch { throw new Error("对象存储公网访问地址格式无效。"); }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("对象存储公网访问地址必须使用 HTTP 或 HTTPS。");
    if (url.username || url.password) throw new Error("对象存储公网访问地址不能包含用户名或密码。");
    if (url.search) throw new Error("对象存储公网访问地址不能包含查询参数。");
    if (url.hash) throw new Error("对象存储公网访问地址不能包含片段。");
    return url;
}

export function validatePublicMediaStorage(): void {
    getPublicMediaConfig();
}

export async function uploadPublicMedia(blob: Blob, kind: PublicMediaKind, options: PublicMediaUploadOptions = {}): Promise<PublicMediaUploadResult> {
    const config = getPublicMediaConfig();
    const extension = extensions[blob.type.toLowerCase()] || (kind === "image" ? "png" : "mp4");
    const key = `public/${kind}/${nanoid()}.${extension}`;
    await uploadObject({ file: new File([blob], key, { type: blob.type }), key, signal: options.signal, configSnapshot: config });
    const baseUrl = requirePublicBaseUrl(config.publicBaseUrl);
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
    return { url: baseUrl.toString(), key };
}
