import axios from "axios";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { dataUrlToFile, getDataUrlByteSize, readFileAsDataUrl } from "@/lib/image-utils";
import { clampVideoSeconds, computeVideoSize, inferVideoRatio } from "@/lib/media-size";
import { resolveArkVideoModel, resolveArkVideoModelId, validateArkVideoSettings, type ArkVideoMode, type ArkVideoModel } from "@/lib/video-model-config";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { boolConfig, buildApiUrl, modelOptionName, resolveModelRequestConfig, resolveModelScript, withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type VideoResponse = { id: string; status?: string; error?: { message?: string }; url?: string; result_url?: string; video_url?: string; content?: { video_url?: string; url?: string } | null };
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
type RequestOptions = { signal?: AbortSignal };
type VideoMediaOptions = RequestOptions & { videos?: ReferenceVideo[]; audios?: ReferenceAudio[] };
const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string; sourceUrl?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "gemini" | "ark" | "plugin"; model: string; baseUrl?: string; arkAccessMode?: AiConfig["arkAccessMode"] };
type GeminiInlineData = { bytesBase64Encoded: string; mimeType: string };
type GeminiVideoOperation = {
    name?: string;
    done?: boolean;
    error?: { message?: string };
    response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } };
};
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

/** Results for scripted (plugin) video models, which run their own create+poll in one shot at task creation. */
const pluginVideoResults = new Map<string, VideoGenerationResult>();

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationResult> {
    return waitForVideoGenerationTask(config, await createVideoGenerationTask(config, prompt, references, options), options);
}

export async function waitForVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw videoTaskFailed(state.error);
        if (attempt === 119) throw new Error(apiText("videoTimeout", { provider: "" }));
        await delay(2500, options?.signal);
    }
    throw new Error(apiText("videoTimeout", { provider: "" }));
}

export function isVideoTaskFailed(error: unknown) {
    return error instanceof Error && error.name === "VideoTaskFailed";
}

function videoTaskFailed(message: string) {
    const error = new Error(message);
    error.name = "VideoTaskFailed";
    return error;
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const script = resolveModelScript(config, selectedModel);
    if (script) return createPluginVideoTask(requestConfig, selectedModel, script, prompt, references, options);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (requestConfig.apiFormat === "ark") return createArkVideoTask(requestConfig, selectedModel, prompt, references, options);
    if (requestConfig.apiFormat === "gemini") return createGeminiVideoTask(requestConfig, selectedModel, prompt, references, options);
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const result = pluginVideoResults.get(task.id);
        return result ? { status: "completed", result } : { status: "failed", error: apiText("pluginVideoExpired") };
    }
    if (task.provider === "ark" && task.model.includes("::") && !config.channels.some((channel) => channel.id === task.model.split("::")[0])) throw new Error("该视频任务所属渠道已删除，请恢复原渠道后继续查询。");
    const requestConfig = resolveModelRequestConfig(config, task.model);
    if (task.provider === "ark") {
        if (task.baseUrl) requestConfig.baseUrl = task.baseUrl;
        if (task.arkAccessMode) requestConfig.arkAccessMode = task.arkAccessMode;
    }
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "ark") return pollArkVideoTask(requestConfig, task, options);
    if (task.provider === "gemini") return pollGeminiVideoTask(requestConfig, task, options);
    return pollOpenAIVideoTask(requestConfig, task, options);
}

async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const result = videoPluginResult(
        await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images: refs,
            videos,
            audios,
            params: {
                seconds: config.apiFormat === "ark" ? config.videoSeconds : normalizeVideoSeconds(config.videoSeconds),
                size: normalizeVideoSize(config.size, config.vquality),
                resolution: config.vquality === "4k" ? "4k" : normalizeVideoResolution(config.vquality),
                ratio: videoAspectRatio(config.size),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
                mode: resolveVideoMode(config.videoMode, refs.length),
            },
            signal: options?.signal,
        }),
    );
    const id = nanoid();
    pluginVideoResults.set(id, result);
    return { id, provider: "plugin", model };
}

function arkVideoUrl(config: AiConfig, id?: string) {
    return withLocalProxy(`${config.baseUrl.trim().replace(/\/+$/, "")}/contents/generations/tasks${id ? `/${encodeURIComponent(id)}` : ""}`);
}

type ArkMediaMetadata = { name: string; type?: string; bytes?: number; width?: number; height?: number; durationMs?: number; fps?: number };

function validateArkMedia(item: ArkMediaMetadata, kind: "image" | "video" | "audio", profile: ArkVideoModel, edit = false) {
    const limits = profile.mediaLimits;
    const bytes = limits[`${kind}Bytes`];
    if (item.bytes !== undefined && (kind === "image" ? item.bytes >= bytes : item.bytes > bytes)) throw new Error(`${item.name} 超出${kind === "image" ? "图片小于" : "文件不超过"} ${bytes / 1024 ** 2} MB 的限制。`);
    const formats = kind === "image" ? ["jpeg", "jpg", "png", "webp", "bmp", "tiff", "tif", "gif", ...(profile.supportsAudio ? ["heic", "heif"] : [])] : kind === "video" ? ["mp4", "mov", "quicktime"] : ["wav", "x-wav", "wave", "mpeg", "mp3"];
    const format = item.type?.split("/")[1]?.split(";")[0];
    if (format && format !== "octet-stream" && !formats.includes(format)) throw new Error(`${item.name} 的${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}格式不受支持。`);
    if (kind !== "audio") {
        const { width, height } = item;
        if ([width, height].some((value) => value !== undefined && (value < 300 || value > 6000))) throw new Error(`${item.name} 的宽高必须在 300–6000 像素之间。`);
        if (width && height && (width / height < 0.4 || width / height > 2.5)) throw new Error(`${item.name} 的宽高比必须在 0.4–2.5 之间。`);
        if (kind === "video" && width && height && (width * height < 407696 || width * height > 8295044)) throw new Error(`${item.name} 的视频总像素数必须在 407696–8295044 之间。`);
        if (kind === "video" && item.fps !== undefined && (item.fps < 24 || item.fps > 60)) throw new Error(`${item.name} 的帧率必须在 24–60 之间。`);
    }
    if (kind !== "image" && item.durationMs !== undefined && (item.durationMs < (edit ? 4 : limits.minDuration) * 1000 || item.durationMs > limits.maxDuration * 1000)) throw new Error(`${item.name} 的时长必须在 ${edit ? 4 : limits.minDuration}–${limits.maxDuration} 秒之间。`);
}

function arkRemoteUrl(value = "") { return /^(https?:\/\/|asset:\/\/).+/i.test(value); }

async function createArkVideoTask(config: AiConfig, model: string, prompt: string, images: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const error = validateArkVideoSettings({ ...config, model });
    if (error) throw new Error(error);
    const profile = resolveArkVideoModel(config.model, config.arkAccessMode)!;
    const mode = config.videoMode as ArkVideoMode;
    const videos = options?.videos || [], audios = options?.audios || [];
    const omni = ["reference", "edit", "extend"].includes(mode);
    if (mode === "text" && !prompt.trim()) throw new Error("文生视频请输入提示词。");
    const imageCount = mode === "text" ? 0 : mode === "first_frame" ? 1 : 2;
    if (!omni && (images.length !== imageCount || videos.length || audios.length)) throw new Error(`当前模式需要 ${imageCount} 张图片，且不能混用参考视频或音频。`);
    if (omni) {
        const limits = profile.mediaLimits;
        if (!images.length && !videos.length && !audios.length) throw new Error("请添加参考素材。");
        if (images.length > limits.images || videos.length > limits.videos || audios.length > limits.audios) throw new Error(`参考素材最多 ${limits.images} 张图片、${limits.videos} 个视频、${limits.audios} 个音频。`);
        if (!limits.audioOnly && audios.length && !images.length && !videos.length) throw new Error("当前模型不能仅参考音频，请同时提供图片或视频。");
        if ((mode === "edit" || mode === "extend") && !videos.length) throw new Error("视频编辑或延长必须提供参考视频。");
        for (const list of [videos, audios]) if (list.reduce((sum, item) => sum + (item.durationMs || 0), 0) > limits.totalDuration * 1000) throw new Error(`参考视频、音频各自总时长不能超过 ${limits.totalDuration} 秒。`);
    }
    const content: Record<string, unknown>[] = prompt.trim() ? [{ type: "text", text: prompt }] : [];
    for (const [index, item] of images.entries()) {
        validateArkMedia(item, "image", profile);
        const source = item.url || item.dataUrl;
        const url = arkRemoteUrl(source) ? source : await imageToDataUrl(item, options);
        if (!arkRemoteUrl(url) && !/^data:image\/[^;]+;base64,/i.test(url)) throw new Error(`${item.name} 不是有效图片来源。`);
        if (url.startsWith("data:")) validateArkMedia({ ...item, bytes: getDataUrlByteSize(url), type: url.slice(5, url.indexOf(";")) }, "image", profile);
        content.push({ type: "image_url", image_url: { url }, role: omni ? "reference_image" : index ? "last_frame" : "first_frame" });
    }
    for (const item of videos) {
        validateArkMedia(item, "video", profile, mode === "edit");
        const url = item.referenceUrl || item.url;
        if (!arkRemoteUrl(url)) throw new Error(`${item.name}：请提供公网 HTTP(S) 视频地址或 Ark 素材 ID，本地视频不能直接作为 Ark 参考。`);
        content.push({ type: "video_url", video_url: { url }, role: "reference_video" });
    }
    for (const item of audios) {
        validateArkMedia(item, "audio", profile);
        let url = item.url;
        if (!arkRemoteUrl(url) && !/^data:audio\/[^;]+;base64,/i.test(url)) {
            const file = await referenceMediaToFile(item, "ref.mp3", "invalidReferenceAudio", options);
            validateArkMedia({ ...item, bytes: file.size, type: file.type }, "audio", profile);
            url = await readFileAsDataUrl(file);
        }
        if (url.startsWith("data:")) validateArkMedia({ ...item, bytes: getDataUrlByteSize(url), type: url.slice(5, url.indexOf(";")) }, "audio", profile);
        content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" });
    }
    const body = {
        model: resolveArkVideoModelId(config.model), content,
        resolution: config.vquality === "4k" ? "4k" : `${config.vquality}p`, ratio: config.size, duration: Number(config.videoSeconds),
        watermark: boolConfig(config.videoWatermark, false),
        ...(profile.supportsAudio ? { generate_audio: boolConfig(config.videoGenerateAudio, true) } : {}),
        ...(profile.modelPrefix === "doubao-seedance-2-5" && omni ? { omni_reference_task_type: mode } : {}),
    };
    if (new Blob([JSON.stringify(body)]).size > 64 * 1024 ** 2) throw new Error("请求体不能超过 64 MB，请将大素材改为公网 URL 或 Ark 素材 ID。");
    try {
        const created = (await axios.post<{ id?: string }>(arkVideoUrl(config), body, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data;
        if (!created.id) throw new Error(apiText("noVideoTaskId"));
        return { id: created.id, provider: "ark", model, baseUrl: config.baseUrl, arkAccessMode: config.arkAccessMode };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollArkVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = (await axios.get<VideoResponse>(arkVideoUrl(config, task.id), { headers: aiHeaders(config), signal: options?.signal })).data;
        if (state.status === "queued" || state.status === "running") return { status: "pending" };
        if (state.status === "succeeded") {
            if (!state.content?.video_url) return { status: "failed", error: "视频任务已成功，但响应缺少视频地址。" };
            return { status: "completed", result: { ...await videoResultFromUrl(state.content.video_url, options), sourceUrl: state.content.video_url } };
        }
        const errors: Record<string, string> = { failed: "视频生成失败。", cancelled: "视频任务已取消。", expired: "视频任务已过期。" };
        if (state.status && errors[state.status]) return { status: "failed", error: readApiErrorMessage(state.error) || errors[state.status] };
        throw new Error(`不支持的视频任务状态：${state.status || "空"}，任务 ID 已保留，可继续查询。`);
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

function videoPluginResult(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string") return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new Error(apiText("scriptNoVideo"));
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (!result.blob && !result.url) throw new Error(apiText("noPlayableVideo"));
    try {
        return await uploadMediaFile(result.blob || result.url!, "video");
    } catch (error) {
        const url = result.sourceUrl || result.url;
        if (!url) throw error;
        return { url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
    }
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const images = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const mode = resolveVideoMode(config.videoMode, images.length);
    const body = new FormData();
    body.append("model", modelOptionName(model));
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    body.append("size", normalizeVideoSize(config.size, config.vquality) || "1280x720");
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("generate_audio", String(boolConfig(config.videoGenerateAudio, true)));
    body.append("watermark", String(boolConfig(config.videoWatermark, false)));
    body.append("mode", mode);
    if (mode === "frames") {
        if (images[0]) body.append("first_frame", images[0], "first.png");
        if (images[1]) body.append("last_frame", images[1], "last.png");
    } else {
        images.forEach((file) => body.append("image[]", file, "ref.png"));
    }
    videos.forEach((file) => body.append("video[]", file));
    audios.forEach((file) => body.append("audio[]", file));
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config), signal: options?.signal })).data);
        if (!created.id) throw new Error(apiText("noVideoTaskId"));
        return { id: created.id, provider: "openai", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = videoResultUrl(video);
        if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        if (video.status === "completed") {
            const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${task.id}/content`), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
            await assertVideoBlob(content.data);
            return { status: "completed", result: { blob: content.data } };
        }
        if (video.status === "failed" || video.status === "cancelled") return { status: "failed", error: readApiErrorMessage(video.error?.message) || apiText("videoGenerationFailed") };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(withLocalProxy(url), { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        return { url, mimeType: "video/mp4" };
    }
}

async function createGeminiVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const images = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => referenceMediaToFile(video, "ref.mp4", "invalidReferenceVideo", options)));
    const audios = await Promise.all((options?.audios || []).map((audio) => referenceMediaToFile(audio, "ref.mp3", "invalidReferenceAudio", options)));
    const mode = resolveVideoMode(config.videoMode, images.length);
    const instance: Record<string, unknown> = { prompt };
    if (mode === "frames") {
        if (images[0]) instance.image = parseDataUrlInline(images[0]);
        if (images[1]) instance.lastFrame = parseDataUrlInline(images[1]);
    } else {
        instance.referenceImages = images.map((dataUrl) => ({ image: parseDataUrlInline(dataUrl), referenceType: "asset" }));
    }
    if (videos[0]) instance.video = await fileToGeminiInline(videos[0]);
    if (audios[0]) instance.audio = await fileToGeminiInline(audios[0]);
    try {
        const created = unwrapEnvelope((await axios.post<ApiEnvelope<GeminiVideoOperation>>(geminiVideoUrl(config, model, "predictLongRunning"), {
            instances: [instance],
            parameters: {
                aspectRatio: videoAspectRatio(config.size),
                durationSeconds: Number(normalizeVideoSeconds(config.videoSeconds)) || 8,
                resolution: normalizeVideoResolution(config.vquality),
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                addWatermark: boolConfig(config.videoWatermark, false),
            },
        }, { headers: geminiVideoHeaders(config), signal: options?.signal })).data, apiText("noVideoTask"));
        if (!created.name) throw new Error(apiText("noVideoTaskId"));
        return { id: created.name, provider: "gemini", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollGeminiVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapEnvelope((await axios.get<ApiEnvelope<GeminiVideoOperation>>(geminiOperationUrl(config, task.id), { headers: geminiVideoHeaders(config), signal: options?.signal })).data, apiText("videoTaskQueryFailed"));
        if (state.error) return { status: "failed", error: readApiErrorMessage(state.error.message) || apiText("videoGenerationFailed") };
        if (!state.done) return { status: "pending" };
        const uri = state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri) return { status: "failed", error: apiText("noPlayableVideo") };
        const url = uri.includes("key=") ? uri : `${uri}${uri.includes("?") ? "&" : "?"}key=${config.apiKey}`;
        return { status: "completed", result: await videoResultFromUrl(url, options) };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(apiText("videoModelRequired"));
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
}

function geminiVideoBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

function geminiVideoUrl(config: Pick<AiConfig, "baseUrl">, model: string, action: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/models/${encodeURIComponent(modelOptionName(model).replace(/^models\//, ""))}:${action}`);
}

function geminiOperationUrl(config: Pick<AiConfig, "baseUrl">, name: string) {
    return withLocalProxy(`${geminiVideoBaseUrl(config)}/${name.replace(/^\//, "")}`);
}

function geminiVideoHeaders(config: Pick<AiConfig, "apiKey">) {
    return { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" };
}

function videoAspectRatio(size: string) {
    const ratio = inferVideoRatio(size);
    return ratio === "auto" ? "16:9" : ratio;
}

function parseDataUrlInline(dataUrl: string, fallbackType = "image/png"): GeminiInlineData {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    return { bytesBase64Encoded: match?.[2] || "", mimeType: match?.[1] || fallbackType };
}

async function fileToGeminiInline(file: File): Promise<GeminiInlineData> {
    return parseDataUrlInline(await readFileAsDataUrl(file), file.type || "application/octet-stream");
}

async function referenceMediaToFile(item: { name: string; type?: string; url?: string; storageKey?: string }, fallbackName: string, errorKey: "invalidReferenceVideo" | "invalidReferenceAudio", options?: RequestOptions) {
    let blob = item.storageKey ? await getMediaBlob(item.storageKey) : null;
    if (!blob) {
        const url = item.storageKey ? await resolveMediaUrl(item.storageKey, item.url || "") : item.url || "";
        if (!url) throw new Error(apiText(errorKey));
        try {
            blob = await (await fetch(url, { signal: options?.signal })).blob();
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            throw new Error(apiText(errorKey));
        }
    }
    if (!blob.size) throw new Error(apiText(errorKey));
    return new File([blob], item.name || fallbackName, { type: item.type || blob.type || "application/octet-stream" });
}

function normalizeVideoSeconds(value: string) {
    return clampVideoSeconds(value);
}

function resolveVideoMode(mode: string | undefined, imageCount: number) {
    if (mode === "reference" || imageCount > 2) return "reference";
    return "frames";
}

function normalizeVideoSize(value: string, resolution?: string) {
    if (value === "auto") return null;
    if (/^\d+x\d+$/.test(value || "")) return value;
    const ratio = inferVideoRatio(value || "16:9");
    if (ratio === "auto") return null;
    return computeVideoSize(resolution || "720", ratio);
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, apiText("noVideoTask"));
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || apiText("requestFailed"));
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function videoResultUrl(payload: VideoResponse) {
    return [payload.video_url, payload.result_url, payload.url, payload.content?.video_url, payload.content?.url].find((url) => typeof url === "string" && (isPublicMediaUrl(url) || /\.mp4(\?|#|$)/i.test(url)));
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return apiText("htmlError", { preview: `${value.slice(0, 80)}...` });
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    // error may be a string or an object containing a message.
    const errorMsg =
        typeof payload.error === "string"
            ? payload.error
            : (payload.error as { message?: unknown })?.message;
    return (
        readApiErrorMessage(payload.msg) ||
        readApiErrorMessage(payload.message) ||
        readApiErrorMessage(errorMsg) ||
        readApiErrorMessage(payload.detail) ||
        ""
    );
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return apiText("requestCanceled");
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; message?: string; code?: number | string }>(error)) {
        if (!error.response && error.code === "ERR_NETWORK") return apiText("requestFailed");
        const responseData = error.response?.data;
        return readApiErrorMessage(responseData) || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return apiText("requestCanceled");
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return apiText("authenticationFailed");
    if (status === 429) return apiText("rateLimited");
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(readApiErrorMessage(payload) || apiText("videoDownloadFailed"));
    if (payload.error?.message) throw new Error(readApiErrorMessage(payload.error.message) || payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
