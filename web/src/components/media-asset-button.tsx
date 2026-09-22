import { useEffect, useState } from "react";
import { App, Button, Modal, Select, Typography, theme } from "antd";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { mediaReferenceScope, prepareMediaReference } from "@/services/api/media-reference-policy";
import { useMediaReferenceStore } from "@/stores/use-media-reference-store";
import { isArkMediaExempt, mediaReferenceKey } from "@/lib/media-reference";
import { resolveModelChannel, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import type { MediaReferenceInput } from "@/types/media-reference";

export function MediaAssetButton({ image, name, kind = "image", compact = false, config: selectedConfig }: {
    image: MediaReferenceInput; name: string; kind?: "image" | "video"; compact?: boolean; config?: AiConfig;
}) {
    const { message } = App.useApp();
    const { token } = theme.useToken();
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const globalConfig = useEffectiveConfig();
    const config = selectedConfig || { ...globalConfig, model: globalConfig.videoModel };
    const channels = config.channels.filter((item) => item.apiFormat === "ark" || item.apiFormat === "kexiang");
    const preferred = resolveModelChannel(config, config.model);
    const [channelId, setChannelId] = useState("");
    const channel = channels.find((item) => item.id === channelId) || channels.find((item) => item.id === preferred.id) || channels[0];
    const targetConfig = channel ? { ...config, model: channel.id === preferred.id ? config.model : `${channel.id}::${channel.models.find((item) => item.capability === "video")?.name || channel.models[0]?.name || ""}` } : config;
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [scope, setScope] = useState("");
    const [progress, setProgress] = useState("");
    const [error, setError] = useState("");
    let identity = "";
    try { identity = mediaReferenceKey(image); } catch { /* The action shows the actionable source error. */ }
    const recordKey = JSON.stringify([identity, scope]);
    const record = useMediaReferenceStore((state) => state.records[recordKey]);
    const pending = useMediaReferenceStore((state) => state.pending.has(recordKey));
    const sharedProgress = useMediaReferenceStore((state) => state.progress[recordKey]);
    const working = busy || pending;
    useEffect(() => {
        let active = true;
        setScope("");
        setError("");
        if (channel) void Promise.all([useMediaReferenceStore.getState().load(), mediaReferenceScope(targetConfig, kind)])
            .then(([, next]) => { if (active) setScope(next); })
            .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "素材记录读取失败"); });
        return () => { active = false; };
    }, [channel, kind, targetConfig.model]);
    const trusted = isArkMediaExempt(image);
    const approved = record?.status === "active" && Boolean(record.assetId);
    const label = working ? "素材处理中" : approved ? "审核已通过" : record?.status === "processing" ? "审核中" : record?.status === "failed" ? "审核失败" : trusted ? "火山生成 · 30天内免审" : "素材审核";
    const prepare = async () => {
        if (working || !channel) return;
        setBusy(true);
        setError("");
        try {
            const url = await prepareMediaReference(targetConfig, { ...image, name }, kind, { forceAudit: true, onProgress: setProgress });
            setProgress(url);
            message.success("素材已就绪，生成时自动复用。");
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "素材审核失败");
        } finally { setBusy(false); }
    };
    return <div className="contents" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
        <button type="button" aria-label={label} title={label} className={`${compact ? "size-7 justify-center" : "min-h-7 max-w-full px-1.5 text-xs"} pointer-events-auto inline-flex shrink-0 items-center gap-1 rounded hover:bg-black/5 dark:hover:bg-white/10`} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setOpen(true); }}>
            {working ? <LoaderCircle className="size-3.5 shrink-0 animate-spin" /> : <ShieldCheck className="size-3.5 shrink-0" />}
            {!compact && <span className="truncate">{label}</span>}
        </button>
        <Modal title={`${kind === "image" ? "图片" : "视频"}素材审核`} open={open} onCancel={() => setOpen(false)} zIndex={isConfigOpen ? token.zIndexPopupBase : undefined} keyboard={!isConfigOpen} footer={null} destroyOnHidden>
            <div className="space-y-3 py-2">
                <Select className="w-full" aria-label="素材审核渠道" value={channel?.id} disabled={working} onChange={(value) => { setChannelId(value); setProgress(""); setError(""); }} options={channels.map((item) => ({ value: item.id, label: item.name }))} placeholder="选择审核渠道" />
                <p className="text-xs opacity-70">生成视频时会自动准备素材。也可提前审核；本地图片或视频将上传到已配置的公网对象存储。</p>
                {trusted && <p className="text-xs">此素材在火山生成后的 30 天内免审，也可以提前创建审核素材。</p>}
                {image.mediaSource?.originalUrl && <div className="text-xs">原始地址：<Typography.Text copyable className="!break-all !text-xs">{image.mediaSource.originalUrl}</Typography.Text></div>}
                {record?.publicUrl && <div className="text-xs">公网地址：<Typography.Text copyable className="!break-all !text-xs">{record.publicUrl}</Typography.Text></div>}
                {record?.assetId && <Typography.Text copyable className="!break-all">{`asset://${record.assetId}`}</Typography.Text>}
                {(sharedProgress || progress) && <div role="status" className="break-all text-xs">{sharedProgress || progress}</div>}
                {(error || record?.error) && <div role="alert" className="break-words text-sm">{error || record?.error}</div>}
                <div className="flex flex-wrap justify-end gap-2">
                    <Button type="text" onClick={() => useConfigStore.getState().openConfigDialog(false, "object-storage")}>对象存储配置</Button>
                    <Button type="text" onClick={() => useConfigStore.getState().openConfigDialog(false, "channels")}>审核渠道配置</Button>
                    <Button type="primary" loading={working} disabled={!channel} onClick={() => void prepare()}>{record?.status === "processing" ? "继续查询" : approved ? "复用审核结果" : "准备并审核"}</Button>
                </div>
            </div>
        </Modal>
    </div>;
}
