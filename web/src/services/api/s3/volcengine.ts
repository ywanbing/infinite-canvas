import type { S3ConnectionConfig, S3Provider } from "./types";

function resolveEndpoint(config: S3ConnectionConfig) {
    const host = `tos-s3-${config.region}.volces.com`;
    let url: URL;
    try { url = new URL(config.endpoint.trim() || `https://${host}`); } catch { throw new Error("请填写有效的火山云 TOS S3 HTTP(S) 地址。"); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/") {
        throw new Error("TOS S3 地址只能包含 HTTP(S) 域名，不包含路径、端口、参数或用户名密码。");
    }
    if (url.hostname !== host && url.hostname !== `${config.bucket.trim()}.${host}`) {
        throw new Error("请使用与区域、Bucket 对应的 tos-s3 域名，不能使用 TOS 原生接口域名。");
    }
    return `${url.protocol}//${host}`;
}

export const volcengine: S3Provider = {
    name: "火山云 TOS",
    regions: [
        { value: "cn-beijing", label: "华北 2 · 北京" },
        { value: "cn-guangzhou", label: "华南 1 · 广州" },
        { value: "cn-shanghai", label: "华东 2 · 上海" },
        { value: "cn-hongkong", label: "中国香港" },
        { value: "ap-southeast-1", label: "亚太东南 · 柔佛" },
        { value: "ap-southeast-3", label: "亚太东南 · 雅加达" },
    ],
    defaultRegion: "cn-beijing",
    docsUrl: "https://docs.volcengine.com/docs/TorchObjectStorage/AccessingTOSUsingAWSS3SDK?lang=zh",
    endpointHint: "火山使用 tos-s3 专属域名与桶子域名寻址；复制对象仅支持同区域。",
    endpointPlaceholder: (region) => `https://tos-s3-${region}.volces.com`,
    resolveEndpoint,
    forcePathStyle: false,
};
