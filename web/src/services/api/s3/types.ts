import type { ObjectStorageConfig } from "./config";

export type S3ConnectionConfig = {
    accessKey: string;
    secretKey: string;
    bucket: string;
    region: string;
    endpoint: string;
    publicBaseUrl: string;
    forcePathStyle: boolean;
};

export type S3Provider = {
    name: string;
    regions: readonly { value: string; label: string }[];
    defaultRegion: string;
    docsUrl: string;
    endpointHint: string;
    endpointPlaceholder: (region: string) => string;
    resolveEndpoint: (config: S3ConnectionConfig) => string;
    // Undefined lets the user choose the addressing mode for a generic S3 service.
    forcePathStyle?: boolean;
    endpointRequired?: boolean;
};

export type RequestOptions = { signal?: AbortSignal };
export type UploadObjectOptions = RequestOptions & { file: File; key: string; configSnapshot?: ObjectStorageConfig };
export type ListObjectsOptions = RequestOptions & { prefix?: string; continuationToken?: string; delimiter?: string; limit?: number };
export type CopyObjectOptions = RequestOptions & { sourceKey: string; destinationKey: string; destinationBucket?: string };
export type ObjectWriteResult = { key: string; etag?: string; lastModified?: string };
export type StorageObject = ObjectWriteResult & { size: number };
export type ObjectList = {
    items: StorageObject[];
    commonPrefixes: string[];
    isTruncated: boolean;
    nextContinuationToken?: string;
};

/** Cloud-independent object operations; SDK-specific responses stay inside the service. */
export interface ObjectStorageApi {
    uploadObject(options: UploadObjectOptions): Promise<ObjectWriteResult>;
    deleteObject(key: string, options?: RequestOptions): Promise<void>;
    listObjects(options?: ListObjectsOptions): Promise<ObjectList>;
    copyObject(options: CopyObjectOptions): Promise<ObjectWriteResult>;
}
