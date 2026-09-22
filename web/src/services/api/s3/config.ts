import { qiniu } from "./qiniu";
import { volcengine } from "./volcengine";
import { generic } from "./generic";
import type { S3ConnectionConfig } from "./types";

// Add each cloud's definition here; the shared API and settings read this registry.
export const s3Providers = { qiniu, volcengine, generic };
export type ObjectStorageConfig = S3ConnectionConfig & { enabled: boolean; provider: keyof typeof s3Providers };
export type ObjectStorageProfiles = Partial<Record<ObjectStorageConfig["provider"], ObjectStorageConfig>>;

export const defaultObjectStorageConfig: ObjectStorageConfig = {
    enabled: false, provider: "qiniu", accessKey: "", secretKey: "", bucket: "", region: qiniu.defaultRegion, endpoint: "", publicBaseUrl: "", forcePathStyle: false,
};

export function isObjectStorageConfig(value: unknown): value is ObjectStorageConfig {
    if (!value || typeof value !== "object") return false;
    const config = value as ObjectStorageConfig;
    if (typeof config.enabled !== "boolean" || typeof config.provider !== "string" || !Object.hasOwn(s3Providers, config.provider)) return false;
    const { regions } = s3Providers[config.provider];
    return typeof config.forcePathStyle === "boolean" && typeof config.region === "string"
        && (!regions.length || regions.some(({ value }) => value === config.region))
        && [config.accessKey, config.secretKey, config.bucket, config.endpoint, config.publicBaseUrl].every((field) => typeof field === "string");
}

export function isObjectStorageProfiles(value: unknown): value is ObjectStorageProfiles {
    return Boolean(value && typeof value === "object" && !Array.isArray(value)
        && Object.entries(value).every(([provider, config]) => isObjectStorageConfig(config) && config.provider === provider));
}
