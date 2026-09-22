import type { S3ConnectionConfig, S3Provider } from "./types";

function resolveEndpoint(config: S3ConnectionConfig) {
    let url: URL;
    try { url = new URL(config.endpoint.trim()); } catch { throw new Error("请填写有效的 S3 HTTP(S) 服务地址。"); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
        throw new Error("S3 服务地址可包含端口，但不能包含路径、参数或用户名密码；Bucket 请单独填写。");
    }
    return url.origin;
}

export const generic: S3Provider = {
    name: "通用 S3",
    regions: [],
    defaultRegion: "us-east-1",
    docsUrl: "https://docs.aws.amazon.com/AmazonS3/latest/API/API_Operations_Amazon_Simple_Storage_Service.html",
    endpointHint: "服务需兼容 S3 V4 签名与 ListObjectsV2；区域和寻址方式请按服务商要求填写。",
    endpointPlaceholder: () => "https://s3.example.com 或 http://localhost:9000",
    endpointRequired: true,
    resolveEndpoint,
};
