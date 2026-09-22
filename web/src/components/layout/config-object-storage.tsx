import { App, Button, Form, Input, Select, Switch, Typography, theme } from "antd";
import { Cloud, ExternalLink, Wifi } from "lucide-react";
import { useState } from "react";

import { s3Providers, type ObjectStorageConfig } from "@/services/api/s3/config";
import { useConfigStore } from "@/stores/use-config-store";

export function ConfigObjectStorage() {
    const { message } = App.useApp();
    const { token } = theme.useToken();
    const config = useConfigStore((state) => state.objectStorage);
    const update = useConfigStore((state) => state.updateObjectStorageConfig);
    const provider = s3Providers[config.provider];
    const [testing, setTesting] = useState(false);
    const ready = config.enabled && Boolean(config.accessKey.trim() && config.secretKey.trim() && config.bucket.trim() && config.region.trim()) && (!provider.endpointRequired || Boolean(config.endpoint.trim()));

    const testConnection = async () => {
        setTesting(true);
        try {
            const { listObjects } = await import("@/services/api/s3");
            await listObjects();
            message.success(`${provider.name} S3 连接成功，已验证对象列表读取权限。`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "对象存储连接测试失败。");
        } finally {
            setTesting(false);
        }
    };

    return (
        <Form layout="vertical" requiredMark={false} disabled={testing}>
            <section className="rounded-lg border p-4" style={{ borderColor: token.colorBorderSecondary }}>
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold"><Cloud className="size-4" />对象存储</div>
                        <Typography.Text type="secondary" className="mt-1 block text-xs">S3 兼容接口 · 浏览器直连 · 配置自动保存在此浏览器</Typography.Text>
                    </div>
                    <Switch checked={config.enabled} disabled={testing} onChange={(enabled) => update("enabled", enabled)} aria-label="启用对象存储" />
                </div>
                <Form.Item label="存储服务商" extra="各服务商配置分别保存在此浏览器，切换后自动恢复；请求使用当前选择的服务商。">
                    <Select<ObjectStorageConfig["provider"]> value={config.provider} options={Object.entries(s3Providers).map(([value, { name }]) => ({ value, label: name }))} onChange={(value) => update("provider", value)} />
                </Form.Item>
                <div className="grid gap-x-4 md:grid-cols-2">
                    <Form.Item label="Access Key（AK）">
                        <Input value={config.accessKey} autoComplete="off" onChange={(event) => update("accessKey", event.target.value)} placeholder={`填写${provider.name} Access Key`} />
                    </Form.Item>
                    <Form.Item label="Secret Key（SK）">
                        <Input.Password value={config.secretKey} autoComplete="new-password" onChange={(event) => update("secretKey", event.target.value)} placeholder={`填写${provider.name} Secret Key`} />
                    </Form.Item>
                    <Form.Item label="S3 空间名称（Bucket）" extra="请填写服务商控制台中的 S3 空间名。">
                        <Input value={config.bucket} onChange={(event) => update("bucket", event.target.value)} placeholder="填写 Bucket 名称" />
                    </Form.Item>
                    <Form.Item label="存储区域">
                        {provider.regions.length ? (
                            <Select value={config.region} options={provider.regions.map((region) => ({ ...region, label: `${region.label}（${region.value}）` }))} onChange={(region) => update("region", region)} />
                        ) : (
                            <Input value={config.region} onChange={(event) => update("region", event.target.value)} placeholder="填写签名区域，例如 us-east-1 或 auto" />
                        )}
                    </Form.Item>
                </div>
                <Form.Item label={`S3 接口地址${provider.endpointRequired ? "" : "（可选）"}`} extra={provider.endpointRequired ? "填写不带 Bucket 的 HTTP(S) 服务地址，可包含端口，不包含路径或查询参数。" : "支持服务域名或包含 Bucket 的完整域名；留空使用所选区域的 HTTPS 服务地址。"}>
                    <Input value={config.endpoint} onChange={(event) => update("endpoint", event.target.value)} placeholder={provider.endpointPlaceholder(config.region)} />
                </Form.Item>
                {provider.forcePathStyle === undefined && (
                    <Form.Item label="Bucket 寻址方式">
                        <Select value={config.forcePathStyle ? "path" : "virtual"} options={[{ value: "path", label: "路径方式 · endpoint/bucket/key" }, { value: "virtual", label: "桶子域名 · bucket.endpoint/key" }]} onChange={(value) => update("forcePathStyle", value === "path")} />
                    </Form.Item>
                )}
                <Form.Item label="公网访问地址" extra="用于生成可匿名访问的图片或视频资源 URL，可填写 CDN 域名及其基础路径；与 S3 接口地址不同。">
                    <Input value={config.publicBaseUrl} onChange={(event) => update("publicBaseUrl", event.target.value)} placeholder="https://cdn.example.com/assets" />
                </Form.Item>
                <Typography.Paragraph type="secondary" className="text-xs">
                    {provider.endpointHint}请求始终直连，不受「本地代理」开关影响；需在云服务商配置当前站点允许访问的 CORS 规则。
                </Typography.Paragraph>
                <div className="flex flex-wrap items-center gap-3">
                    <Button icon={<Wifi className="size-4" />} disabled={!ready} loading={testing} onClick={() => void testConnection()}>测试连接</Button>
                    <Typography.Link href={provider.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs">{provider.name} S3 文档<ExternalLink className="size-3" /></Typography.Link>
                </div>
                <div className="mt-5 space-y-2 border-t pt-3" style={{ borderColor: token.colorBorderSecondary }}>
                    <Typography.Text type="secondary" className="block text-xs">仅接入上传、删除、对象列表和复制。本页用于配置和连接测试；上传或复制到同名对象会覆盖目标对象，请调用方确认目标名称。</Typography.Text>
                    <Typography.Text type="secondary" className="block text-xs">AK / SK 保存在当前浏览器，导出的配置文件也包含凭据，请妥善保管。此配置不会自动同步画布或我的素材。</Typography.Text>
                </div>
            </section>
        </Form>
    );
}
