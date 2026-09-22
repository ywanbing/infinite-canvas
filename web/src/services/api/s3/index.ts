import { CopyObjectCommand, DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { FetchHttpHandler } from "@smithy/fetch-http-handler";

import { useConfigStore } from "@/stores/use-config-store";
import { isObjectStorageConfig, s3Providers, type ObjectStorageConfig } from "./config";
import type { ObjectStorageApi } from "./types";

export type { ObjectStorageApi, UploadObjectOptions, ListObjectsOptions, CopyObjectOptions, RequestOptions, ObjectWriteResult, StorageObject, ObjectList } from "./types";

async function withClient<T>(run: (client: S3Client, bucket: string) => Promise<T>, configSnapshot?: ObjectStorageConfig) {
    const config = configSnapshot || useConfigStore.getState().objectStorage;
    if (!isObjectStorageConfig(config)) throw new Error("对象存储配置无效，请重新填写配置。");
    if (!config.enabled) throw new Error("请先启用对象存储。");
    if (!config.region.trim()) throw new Error("请填写对象存储签名区域。");
    if (!config.accessKey.trim() || !config.secretKey.trim() || !config.bucket.trim()) throw new Error("请填写对象存储 Access Key、Secret Key 和 S3 Bucket。");
    const provider = s3Providers[config.provider];
    const client = new S3Client({
        endpoint: provider.resolveEndpoint(config),
        region: config.region.trim(),
        credentials: { accessKeyId: config.accessKey.trim(), secretAccessKey: config.secretKey.trim() },
        // Independent direct transport, never the withLocalProxy request chain.
        requestHandler: new FetchHttpHandler({ credentials: "omit", cache: "no-store", requestInit: () => ({ redirect: "error" }) }),
        forcePathStyle: provider.forcePathStyle ?? config.forcePathStyle,
        maxAttempts: 1,
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
    });
    try {
        return await run(client, config.bucket.trim());
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        if (error instanceof S3ServiceException) throw new Error(`${provider.name} S3 请求失败（HTTP ${error.$metadata.httpStatusCode ?? "未知"} / ${error.name}）：${error.message}`);
        if (error instanceof TypeError) throw new Error(`${provider.name} S3 直连失败，请检查网络、服务地址及 Bucket 的 CORS 配置。对象存储不使用代理。`);
        throw error;
    } finally {
        client.destroy();
    }
}

function requireKey(key: string) {
    if (!key) throw new Error("对象名称不能为空。");
    return key; // Spaces are significant in object names.
}

/** One page per request; pass nextContinuationToken while isTruncated is true. */
export const listObjects: ObjectStorageApi["listObjects"] = async ({ prefix, continuationToken, delimiter, limit, signal } = {}) => {
    const result = await withClient((client, bucket) => client.send(new ListObjectsV2Command({
        Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken, Delimiter: delimiter, MaxKeys: limit,
    }), { abortSignal: signal }));
    return {
        items: (result.Contents || []).map((item) => ({ key: requireKey(item.Key || ""), size: item.Size ?? 0, etag: item.ETag, lastModified: item.LastModified?.toISOString() })),
        commonPrefixes: (result.CommonPrefixes || []).map((item) => item.Prefix || ""),
        isTruncated: Boolean(result.IsTruncated),
        nextContinuationToken: result.NextContinuationToken,
    };
};

/** Upload replaces an existing object with the same key; callers must confirm their target. */
export const uploadObject: ObjectStorageApi["uploadObject"] = async ({ file, key, signal, configSnapshot }) => {
    requireKey(key);
    const result = await withClient((client, bucket) => client.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: file, ContentType: file.type || "application/octet-stream",
    }), { abortSignal: signal }), configSnapshot);
    return { key, etag: result.ETag };
};

export { uploadPublicMedia, validatePublicMediaStorage } from "./media";
export type { PublicMediaKind, PublicMediaUploadOptions, PublicMediaUploadResult } from "./media";

export const deleteObject: ObjectStorageApi["deleteObject"] = async (key, { signal } = {}) => {
    requireKey(key);
    await withClient((client, bucket) => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal }));
};

/** Copy replaces an existing target. Source and destination must satisfy the cloud's region and permission rules. */
export const copyObject: ObjectStorageApi["copyObject"] = async ({ sourceKey, destinationKey, destinationBucket, signal }) => {
    requireKey(sourceKey);
    requireKey(destinationKey);
    const result = await withClient((client, bucket) => client.send(new CopyObjectCommand({
        Bucket: destinationBucket?.trim() || bucket,
        Key: destinationKey,
        CopySource: `/${[bucket, ...sourceKey.split("/")].map(encodeURIComponent).join("/")}`,
    }), { abortSignal: signal }));
    return { key: destinationKey, etag: result.CopyObjectResult?.ETag, lastModified: result.CopyObjectResult?.LastModified?.toISOString() };
};
