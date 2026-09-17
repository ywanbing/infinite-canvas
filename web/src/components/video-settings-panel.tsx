import { type ReactNode } from "react";
import { InputNumber, Slider, Switch } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio, parseVideoResolution, readVideoDimensions, VIDEO_SECONDS_MAX, VIDEO_SECONDS_MIN, videoRatioOptions } from "@/lib/media-size";
import { resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import { getArkVideoCapabilities, validateArkVideoSettings, type ArkVideoMode } from "@/lib/video-model-config";

const resolutionOptions = [
    { value: "480", label: "480p" },
    { value: "720", label: "720p" },
    { value: "1080", label: "1080p" },
];
const videoModeOptions = [
    { value: "frames", labelKey: "frames" },
    { value: "reference", labelKey: "reference" },
];

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = videoRatioOptions.map((item) => ({ value: item.value, get label() { return item.value === "auto" ? i18n.t("settingsPanels.common.auto") : item.value; } }));
export const videoSecondsRange = { min: VIDEO_SECONDS_MIN, max: VIDEO_SECONDS_MAX };

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoMode", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const request = resolveModelRequestConfig(config, config.model);
    const seconds = Number(clampVideoSeconds(config.videoSeconds || "6"));
    const videoMode = normalizeVideoModeValue(config.videoMode);
    const resolution = parseVideoResolution(config.vquality);
    const selectedRatio = inferVideoRatio(config.size || "auto");
    const dimensions = readVideoDimensions(config.size || "auto", resolution, selectedRatio);
    const applySize = (nextResolution: string, ratio: string) => {
        onConfigChange("vquality", nextResolution);
        onConfigChange("size", computeVideoSize(nextResolution, ratio));
    };
    const selectResolution = (nextResolution: string) => {
        if (selectedRatio === "auto") onConfigChange("vquality", nextResolution);
        else applySize(nextResolution, selectedRatio);
    };

    if (request.apiFormat === "ark" && !resolveModelScript(config, config.model)) return <ArkVideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}
                <SettingGroup title={t("settingsPanels.video.quality")} color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => selectResolution(item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                        <ResolutionInput value={resolution} theme={theme} onChange={selectResolution} />
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.size")} color={theme.node.muted}>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={selectedRatio === "auto"} theme={theme} onChange={(value) => updateDimension("width", value, dimensions, onConfigChange)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={selectedRatio === "auto"} theme={theme} onChange={(value) => updateDimension("height", value, dimensions, onConfigChange)} />
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.ratio")} color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {videoRatioOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: selectedRatio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => applySize(resolution, item.value)}
                            >
                                <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.value === "auto" ? t("settingsPanels.common.auto") : item.value}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.seconds")} color={theme.node.muted}>
                    <div className="flex items-center gap-3" onMouseDown={(event) => event.stopPropagation()}>
                        <Slider className="min-w-0 flex-1" min={VIDEO_SECONDS_MIN} max={VIDEO_SECONDS_MAX} step={1} value={seconds} onChange={(value) => onConfigChange("videoSeconds", String(Array.isArray(value) ? value[0] : value))} />
                        <SecondsInput value={seconds} theme={theme} onCommit={(value) => onConfigChange("videoSeconds", String(value))} />
                        <span className="shrink-0 text-sm" style={{ color: theme.node.muted }}>s</span>
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.mode")} color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2.5">
                        {videoModeOptions.map((item) => (
                            <OptionPill key={item.value} selected={videoMode === item.value} theme={theme} onClick={() => onConfigChange("videoMode", item.value)}>
                                {t(`settingsPanels.video.modes.${item.labelKey}`)}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    if (value.toLowerCase() === "4k") return "4K";
    return `${parseVideoResolution(value)}p`;
}

export function videoSizeLabel(value: string) {
    if (value === "adaptive") return "自适应";
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? i18n.t("settingsPanels.video.adaptive") : ratio;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return i18n.t("settingsPanels.video.smart");
    return `${value || "6"}s`;
}

export function videoModeLabel(value: string) {
    if (value in arkModeLabels) return arkModeLabels[value as ArkVideoMode];
    return i18n.t(`settingsPanels.video.modes.${normalizeVideoModeValue(value)}`);
}

export function normalizeVideoModeValue(value: string | undefined) {
    return value && value in arkModeLabels ? value : "frames";
}

export function normalizeVideoSizeValue(value: string, resolution = "720") {
    if (value === "adaptive") return value;
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value);
    return ratio === "auto" ? "auto" : computeVideoSize(resolution, ratio);
}

export function normalizeVideoResolutionValue(value: string) {
    if (value.toLowerCase() === "4k") return "4k";
    return parseVideoResolution(value);
}

const arkModeLabels: Record<ArkVideoMode, string> = { text: "文生视频", first_frame: "首帧", first_last_frame: "首尾帧", reference: "全模态参考", edit: "视频编辑", extend: "视频延长" };

function ArkVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps) {
    const profile = getArkVideoCapabilities(config);
    const error = validateArkVideoSettings(config);
    const mode = config.videoMode as ArkVideoMode;
    const ratios = profile?.ratios[mode] || [];
    const applyDefaults = () => {
        if (!profile) return;
        onConfigChange("videoMode", profile.defaultMode);
        onConfigChange("vquality", profile.defaultResolution);
        onConfigChange("size", profile.defaultRatio);
        onConfigChange("videoSeconds", String(profile.duration.default));
        onConfigChange("videoWatermark", "false");
        onConfigChange("videoGenerateAudio", String(profile.supportsAudio));
    };
    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle && <div className="text-lg font-semibold">视频设置</div>}
                {error && <div role="alert" className="text-xs leading-5">{error}</div>}
                {profile && <>
                    <div className="flex items-center justify-between gap-2 text-xs" style={{ color: theme.node.muted }}>
                        <span>{profile.name}</span>
                        <button type="button" className="shrink-0 rounded px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10" onClick={applyDefaults}>使用模型默认值</button>
                    </div>
                    <SettingGroup title="生成模式" color={theme.node.muted}>
                        <div className="grid grid-cols-2 gap-2">{profile.modes.map((value) => <OptionPill key={value} selected={mode === value} theme={theme} onClick={() => onConfigChange("videoMode", value)}>{arkModeLabels[value]}</OptionPill>)}</div>
                    </SettingGroup>
                    <SettingGroup title="分辨率" color={theme.node.muted}>
                        <div className="grid grid-cols-4 gap-2">{profile.resolutions.map((value) => <OptionPill key={value} selected={config.vquality === value} theme={theme} onClick={() => onConfigChange("vquality", value)}>{videoResolutionLabel(value)}</OptionPill>)}</div>
                    </SettingGroup>
                    <SettingGroup title="比例" color={theme.node.muted}>
                        <div className="grid grid-cols-3 gap-2">{ratios.map((value) => <OptionPill key={value} selected={config.size === value} theme={theme} onClick={() => onConfigChange("size", value)}>{value === "adaptive" ? "自适应" : value}</OptionPill>)}</div>
                        <div className="text-xs" style={{ color: theme.node.muted }}>当前：{config.size}；实际像素尺寸以生成结果为准。</div>
                    </SettingGroup>
                    <SettingGroup title={mode === "edit" ? "时长（编辑仅支持智能时长）" : `时长（${profile.duration.min}–${profile.duration.max} 秒）`} color={theme.node.muted}>
                        <div className="flex items-center gap-3">
                            {profile.duration.auto && <OptionPill selected={config.videoSeconds === "-1"} theme={theme} onClick={() => onConfigChange("videoSeconds", "-1")}>智能时长</OptionPill>}
                            {mode !== "edit" && <InputNumber aria-label="视频秒数" min={profile.duration.min} max={profile.duration.max} precision={0} value={config.videoSeconds === "-1" ? null : Number(config.videoSeconds)} placeholder="秒" onChange={(value) => value !== null && onConfigChange("videoSeconds", String(value))} />}
                        </div>
                    </SettingGroup>
                    {profile.supportsAudio && <label className="flex items-center justify-between text-sm">生成声音<Switch checked={config.videoGenerateAudio !== "false"} onChange={(value) => onConfigChange("videoGenerateAudio", String(value))} /></label>}
                    <label className="flex items-center justify-between text-sm">视频水印<Switch checked={config.videoWatermark === "true"} onChange={(value) => onConfigChange("videoWatermark", String(value))} /></label>
                    <div className="text-xs leading-5" style={{ color: theme.node.muted }}>
                        {mode === "text" ? "文生视频不接收参考素材。" : mode === "first_frame" ? "请提供一张首帧图片。" : mode === "first_last_frame" ? "请按顺序提供首帧、尾帧两张图片。" : `最多 ${profile.mediaLimits.images} 张图片、${profile.mediaLimits.videos} 段视频、${profile.mediaLimits.audios} 段音频；视频和音频各自总时长不超过 ${profile.mediaLimits.totalDuration} 秒。${profile.mediaLimits.audioOnly ? "" : "音频需搭配图片或视频。"}`}
                        {(mode === "edit" || mode === "extend") && "必须提供参考视频，比例选择自适应。"}
                    </div>
                </>}
            </div>
        </ImageSettingsTheme>
    );
}

function updateDimension(key: "width" | "height", value: number | null, dimensions: { width: number; height: number }, onConfigChange: VideoSettingsPanelProps["onConfigChange"]) {
    const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
    onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" disabled={disabled} className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function ResolutionInput({ value, theme, onChange }: { value: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input type="number" min={1} className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />
            <span className="grid w-7 place-items-center pr-1" style={{ color: theme.node.muted }}>
                p
            </span>
        </label>
    );
}

function SecondsInput({ value, theme, onCommit }: { value: number; theme: CanvasTheme; onCommit: (value: number) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = Number(clampVideoSeconds(input.value));
        input.value = String(next);
        onCommit(next);
    };

    return (
        <label className="flex h-9 w-[68px] shrink-0 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text }}>
            <input
                type="number"
                min={VIDEO_SECONDS_MIN}
                max={VIDEO_SECONDS_MAX}
                className="min-w-0 flex-1 bg-transparent px-2 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value}
                key={value}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input type="number" min={1} disabled={disabled} className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
        </label>
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}
