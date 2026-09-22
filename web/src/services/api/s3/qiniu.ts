import type { S3ConnectionConfig, S3Provider } from "./types";

function resolveEndpoint(config: S3ConnectionConfig) {
    const host = `s3.${config.region}.qiniucs.com`;
    let url: URL;
    try { url = new URL(config.endpoint.trim() || `https://${host}`); } catch { throw new Error("请填写有效的七牛 S3 HTTP(S) 地址。"); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/") {
        throw new Error("S3 地址只能包含 HTTP(S) 域名，不包含路径、端口、参数或用户名密码。");
    }
    if (url.hostname !== host && url.hostname !== `${config.bucket.trim()}.${host}`) {
        throw new Error("S3 地址与所选区域或 Bucket 不一致，请检查配置。");
    }
    // The SDK adds the destination bucket itself, including for cross-bucket copies.
    return `${url.protocol}//${host}`;
}

export const qiniu: S3Provider = {
    name: "七牛云",
    regions: [
        { value: "cn-east-1", label: "华东 · 浙江" },
        { value: "cn-east-2", label: "华东 · 浙江 2" },
        { value: "cn-north-1", label: "华北 · 河北" },
        { value: "cn-south-1", label: "华南 · 广东" },
        { value: "us-north-1", label: "北美 · 洛杉矶" },
        { value: "ap-southeast-1", label: "亚太 · 新加坡" },
        { value: "ap-southeast-2", label: "亚太 · 河内（存量区域）" },
        { value: "ap-southeast-3", label: "亚太 · 胡志明（存量区域）" },
    ],
    defaultRegion: "cn-south-1",
    docsUrl: "https://developer-doc.qiniu.com/products/kodo/development-guidelines/aws-s3-compatible",
    endpointHint: "例如 https://ywb-canvas.s3.cn-south-1.qiniucs.com，对应 Bucket 为 ywb-canvas、区域为华南。",
    endpointPlaceholder: (region) => `https://s3.${region}.qiniucs.com`,
    resolveEndpoint,
    forcePathStyle: false,
};
