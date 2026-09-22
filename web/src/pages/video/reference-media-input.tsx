import { useRef, useState } from "react";
import { App, Button, Input } from "antd";
import { Plus, ShieldCheck, Trash2, Upload } from "lucide-react";
import { nanoid } from "nanoid";
import { uploadMediaFile } from "@/services/file-storage";
import { MediaAssetButton } from "@/components/media-asset-button";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export function ReferenceMediaInput({ videos, audios, onVideosChange, onAudiosChange, allowedMedia, auditEnabled, onAuditAudio }: {
    videos: ReferenceVideo[]; audios: ReferenceAudio[];
    onVideosChange: (items: ReferenceVideo[]) => void; onAudiosChange: (items: ReferenceAudio[]) => void; allowedMedia: { video: boolean; audio: boolean };
    auditEnabled?: boolean; onAuditAudio?: (item: ReferenceAudio) => Promise<void>;
}) {
    const { message } = App.useApp();
    const input = useRef<HTMLInputElement>(null);
    const videoInput = useRef<HTMLInputElement>(null);
    const [videoUrl, setVideoUrl] = useState("");
    const [audioUrl, setAudioUrl] = useState("");
    const [auditing, setAuditing] = useState<Set<string>>(() => new Set());
    const audit = async (id: string, action?: () => Promise<void>) => {
        if (!action) return;
        setAuditing((value) => new Set(value).add(id));
        try { await action(); } catch (error) { message.error(error instanceof Error ? error.message : "素材审核失败"); }
        finally { setAuditing((value) => { const next = new Set(value); next.delete(id); return next; }); }
    };
    const addUrl = (kind: "video" | "audio") => {
        const url = (kind === "video" ? videoUrl : audioUrl).trim();
        if (!/^(https?:\/\/|asset:\/\/).+/i.test(url)) { message.error("请输入公网 HTTP(S) 地址或 asset:// 素材 ID"); return; }
        const item = { id: nanoid(), name: url, url, type: "" };
        if (kind === "video") { onVideosChange([...videos, item]); setVideoUrl(""); }
        else { onAudiosChange([...audios, item]); setAudioUrl(""); }
    };
    const addAudio = async (files: File[]) => {
        try {
            const items = await Promise.all(files.map(async (file) => {
                const stored = await uploadMediaFile(file, "audio");
                return { id: nanoid(), name: file.name, type: stored.mimeType, url: stored.url, storageKey: stored.storageKey, durationMs: stored.durationMs, bytes: stored.bytes };
            }));
            onAudiosChange([...audios, ...items]);
        } catch (error) { message.error(error instanceof Error ? error.message : "读取音频失败"); }
    };
    const addVideos = async (files: File[]) => {
        try {
            const items = await Promise.all(files.map(async (file) => {
                const stored = await uploadMediaFile(file, "video");
                return { ...stored, id: nanoid(), name: file.name, type: stored.mimeType };
            }));
            onVideosChange([...videos, ...items]);
        } catch (error) { message.error(error instanceof Error ? error.message : "读取视频失败"); }
    };
    return <div className="space-y-3">
        <div className="text-sm font-semibold">参考视频与音频</div>
        <div className="text-xs opacity-60">{auditEnabled ? "本地视频在生成前上传公网并准备审核；也可添加 HTTP(S) 或 asset://。" : "视频使用公网 HTTP(S) 或 asset://。"}{allowedMedia.audio && "音频支持 MP3 / WAV 文件及远程地址。"}</div>
        {((!allowedMedia.video && videos.length > 0) || (!allowedMedia.audio && audios.length > 0)) && <div role="alert" className="text-xs">当前模式不接收已添加的参考视频或音频，请移除对应素材或切换模式。</div>}
        {allowedMedia.video &&
            <div className="flex gap-2"><Input aria-label="参考视频地址" value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} onPressEnter={() => addUrl("video")} placeholder="参考视频 HTTP(S) / asset://" /><Button type="text" aria-label="添加参考视频" icon={<Plus className="size-4" />} onClick={() => addUrl("video")} />{auditEnabled && <Button type="text" aria-label="选择视频文件" icon={<Upload className="size-4" />} onClick={() => videoInput.current?.click()} />}</div>
        }
        {allowedMedia.audio &&
            <div className="flex gap-2"><Input aria-label="参考音频地址" value={audioUrl} onChange={(event) => setAudioUrl(event.target.value)} onPressEnter={() => addUrl("audio")} placeholder="参考音频 HTTP(S) / asset://" /><Button type="text" aria-label="添加参考音频" icon={<Plus className="size-4" />} onClick={() => addUrl("audio")} /><Button type="text" aria-label="选择音频文件" icon={<Upload className="size-4" />} onClick={() => input.current?.click()} /></div>
        }
        {videos.map((item, index) => <div key={item.id} className="flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 truncate" title={item.url}>视频 {index + 1} · {item.name}</span>{auditEnabled && <MediaAssetButton image={item} name={item.name} kind="video" />}<Button type="text" aria-label="移除参考视频" icon={<Trash2 className="size-3.5" />} onClick={() => onVideosChange(videos.filter((ref) => ref.id !== item.id))} /></div>)}
        {audios.map((item, index) => <div key={item.id} className="flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 truncate" title={item.name}>音频 {index + 1} · {item.name}</span>{auditEnabled && onAuditAudio && <Button type="text" loading={auditing.has(item.id)} aria-label="素材审核" title="素材审核" icon={<ShieldCheck className="size-3.5" />} onClick={() => void audit(item.id, () => onAuditAudio(item))} />}<Button type="text" aria-label="移除参考音频" icon={<Trash2 className="size-3.5" />} onClick={() => onAudiosChange(audios.filter((ref) => ref.id !== item.id))} /></div>)}
        <input ref={input} type="file" accept="audio/mpeg,audio/wav,.mp3,.wav" multiple className="hidden" onChange={(event) => { void addAudio(Array.from(event.target.files || [])); event.target.value = ""; }} />
        <input ref={videoInput} type="file" accept="video/mp4,video/quicktime,.mp4,.mov" multiple className="hidden" onChange={(event) => { void addVideos(Array.from(event.target.files || [])); event.target.value = ""; }} />
    </div>;
}
