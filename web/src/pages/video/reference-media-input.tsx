import { useRef, useState } from "react";
import { App, Button, Input } from "antd";
import { Plus, Trash2, Upload } from "lucide-react";
import { nanoid } from "nanoid";
import { uploadMediaFile } from "@/services/file-storage";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export function ReferenceMediaInput({ videos, audios, onVideosChange, onAudiosChange, allowAdd }: {
    videos: ReferenceVideo[]; audios: ReferenceAudio[];
    onVideosChange: (items: ReferenceVideo[]) => void; onAudiosChange: (items: ReferenceAudio[]) => void; allowAdd: boolean;
}) {
    const { message } = App.useApp();
    const input = useRef<HTMLInputElement>(null);
    const [videoUrl, setVideoUrl] = useState("");
    const [audioUrl, setAudioUrl] = useState("");
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
    return <div className="space-y-3">
        <div className="text-sm font-semibold">参考视频与音频</div>
        <div className="text-xs opacity-60">视频使用公网 HTTP(S) 或 asset://，本地视频不能直接提交；音频支持 MP3 / WAV 文件及远程地址。</div>
        {!allowAdd && <div role="alert" className="text-xs">当前模式不接收参考视频或音频，请移除已有素材或切换模式。</div>}
        {allowAdd && <>
            <div className="flex gap-2"><Input aria-label="参考视频地址" value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} onPressEnter={() => addUrl("video")} placeholder="参考视频 HTTP(S) / asset://" /><Button type="text" aria-label="添加参考视频" icon={<Plus className="size-4" />} onClick={() => addUrl("video")} /></div>
            <div className="flex gap-2"><Input aria-label="参考音频地址" value={audioUrl} onChange={(event) => setAudioUrl(event.target.value)} onPressEnter={() => addUrl("audio")} placeholder="参考音频 HTTP(S) / asset://" /><Button type="text" aria-label="添加参考音频" icon={<Plus className="size-4" />} onClick={() => addUrl("audio")} /><Button type="text" aria-label="选择音频文件" icon={<Upload className="size-4" />} onClick={() => input.current?.click()} /></div>
        </>}
        {videos.map((item, index) => <div key={item.id} className="flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 truncate" title={item.url}>视频 {index + 1} · {item.name}</span><Button type="text" aria-label="移除参考视频" icon={<Trash2 className="size-3.5" />} onClick={() => onVideosChange(videos.filter((ref) => ref.id !== item.id))} /></div>)}
        {audios.map((item, index) => <div key={item.id} className="flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 truncate" title={item.name}>音频 {index + 1} · {item.name}</span><Button type="text" aria-label="移除参考音频" icon={<Trash2 className="size-3.5" />} onClick={() => onAudiosChange(audios.filter((ref) => ref.id !== item.id))} /></div>)}
        <input ref={input} type="file" accept="audio/mpeg,audio/wav,.mp3,.wav" multiple className="hidden" onChange={(event) => { void addAudio(Array.from(event.target.files || [])); event.target.value = ""; }} />
    </div>;
}
