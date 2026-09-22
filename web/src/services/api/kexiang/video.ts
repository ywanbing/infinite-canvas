import axios from "axios";
import i18n from "@/i18n";
import { isKexiangSeedanceModel, resolveKexiangModelRequest, validateKexiangVideoMode } from "@/lib/kexiang-models";
import { readFileAsDataUrl } from "@/lib/image-utils";
import { imageReferenceRemoteUrl } from "@/lib/image-reference-url";
import { getMediaBlob, resolveMediaUrl } from "@/services/file-storage";
import { prepareMediaReference } from "../media-reference-policy";
import { boolConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import type { VideoGenerationTask, VideoGenerationTaskState } from "../video";
import { readApiErrorMessage, readAxiosError, type RequestOptions } from "../request-utils";
import { normalizeVideoResolution, normalizeVideoSeconds, normalizeVideoSize, videoAspectRatio, videoResultFromUrl } from "../video-common";
import { createKexiangTask, queryKexiangTask, kexiangTaskUrls } from "./client";

type VideoMediaOptions = RequestOptions & { videos?: ReferenceVideo[]; audios?: ReferenceAudio[]; onProgress?: (message: string) => void };
const apiText = (key: string) => i18n.t(`apiErrors.${key}`);

function videoRequestError(error: unknown, context: string) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    const detail = readAxiosError(error, apiText("requestFailed"));
    return new Error(`${context}${status ? `（HTTP ${status}）` : ""}：${detail}`);
}

export async function createKexiangVideoTask(config: AiConfig, model: string, prompt: string, images: ReferenceImage[], options?: VideoMediaOptions, sourceConfig: AiConfig = config): Promise<VideoGenerationTask> {
    const modelName = config.model;
    const request = resolveKexiangModelRequest(modelName);
    if (!request) throw new Error(`可想AI未配置模型 ${modelName} 的请求映射。`);
    const modelType = config.videoMode;
    const modeError = validateKexiangVideoMode(modelName, modelType);
    if (modeError) throw new Error(modeError);
    const videoCount = options?.videos?.length || 0;
    const audioCount = options?.audios?.length || 0;
    if (modelType === "text2video" && (images.length || videoCount || audioCount)) throw new Error("文生视频不接收参考素材，请移除素材或切换生成模式。");
    if (modelType === "text2video" && !prompt.trim()) throw new Error(apiText("videoPromptRequired"));
    if (modelType === "img2video" && !images.length) throw new Error("图生视频需要参考图片。");
    if (modelType === "img2video" && !["Kling-v3-omni", "GoogleOmni"].includes(modelName) && images.length !== 1) throw new Error("当前模型的图生视频使用一张首帧图，请选择首尾帧或全能参考模式以使用多张图片。");
    if (modelType === "frame2video" && images.length !== 2) throw new Error("首尾帧生视频需要按顺序提供首帧、尾帧两张图片。");
    if (modelType !== "mixVideo" && modelType !== "motionControl" && (videoCount || audioCount)) throw new Error("当前生成模式不接收参考视频或音频，请移除素材或切换模式。");
    if (audioCount && (modelType !== "mixVideo" || !request.referenceAudio)) throw new Error("当前模型的生成模式不支持参考音频。");
    if (modelType === "mixVideo" && !images.length && !videoCount && !audioCount) throw new Error("全能参考需要参考素材；仅使用提示词请选择文生视频。");
    if (modelType === "motionControl" && (images.length !== 1 || videoCount !== 1)) throw new Error("动作控制需要一张参考图和一个参考视频。");
    const seedance = isKexiangSeedanceModel(modelName);
    const content: Record<string, unknown>[] = prompt.trim() ? [{ type: "text", text: prompt }] : [];
    const imageUrls = await Promise.all(images.map((image) => {
        if (seedance) return prepareMediaReference(sourceConfig, image, "image", options);
        const url = imageReferenceRemoteUrl(image);
        if (!url) throw new Error(`${image.name || "参考图"} 需要有效的公网 HTTP(S) 地址或 asset:// 素材 ID，当前模型不支持本地图片回退。`);
        return url;
    }));
    for (const source of imageUrls) {
        content.push({ type: "image_url", image_url: { url: source }, role: "reference_image" });
    }
    for (const video of options?.videos || []) {
        const source = seedance ? await prepareMediaReference(sourceConfig, video, "video", options) : video.referenceUrl || video.url;
        content.push({ type: "video_url", video_url: { url: source }, role: "reference_video" });
    }
    for (const audio of options?.audios || []) {
        let source = audio.referenceUrl || audio.url;
        if (seedance && !/^(https?:\/\/|asset:\/\/|data:)/i.test(source)) {
            const blob = (audio.storageKey ? await getMediaBlob(audio.storageKey) : null) || await (await fetch(await resolveMediaUrl(audio.storageKey, source), { signal: options?.signal })).blob();
            source = await readFileAsDataUrl(new File([blob], audio.name || "ref.mp3", { type: audio.type || blob.type }));
        }
        content.push({ type: "audio_url", audio_url: { url: source }, role: "reference_audio" });
    }
    if (!content.length) throw new Error(apiText("videoPromptRequired"));
    const ratio = videoAspectRatio(config.size);
    const resolution = normalizeVideoResolution(config.vquality);
    const duration = Number(normalizeVideoSeconds(config.videoSeconds));
    const videoUrls = (options?.videos || []).map((item) => item.referenceUrl || item.url).filter(Boolean);
    const audioUrls = (options?.audios || []).map((item) => item.referenceUrl || item.url).filter(Boolean);
    let userInput: Record<string, unknown>;
    if (modelName === "MiniMaxH3") {
        const modelResolution = request.resolutions?.find((item) => item.value === resolution.replace(/p$/i, ""))?.label;
        if (!modelResolution) throw new Error("MiniMax-H3 请选择 768P 或 2K 分辨率。");
        userInput = { modelName, modelType, prompt, ...(modelType === "mixVideo" ? { images: imageUrls.join(","), videos: videoUrls.join(","), audios: audioUrls.join(",") } : modelType === "text2video" ? {} : { firstFrameUrl: imageUrls[0], ...(modelType === "frame2video" ? { lastFrameUrl: imageUrls[1] } : {}) }), ratio, resolution: modelResolution, duration };
    } else if (modelName === "KlingV3") {
        userInput = { modelName, modelType, model: "v3.0", image_url: imageUrls[0] || "", image_tail_url: imageUrls[1] || "", prompt, negative_prompt: "", duration: String(duration), resolution, sound: boolConfig(config.videoGenerateAudio, true) ? "on" : "off", size: ratio, logo_add: boolConfig(config.videoWatermark, false) ? 1 : 0 };
    } else if (modelName === "Kling-v3-omni") {
        const imageList = imageUrls.map((url, index) => ({ image_url: url, ...(modelType === "frame2video" ? { type: index ? "end_frame" : "first_frame" } : {}) }));
        userInput = { modelName, modelType, prompt, ...(modelType !== "text2video" ? { image_list: imageList } : {}), ...(modelType === "mixVideo" ? { video_list: videoUrls.map((url) => ({ video_url: url, refer_type: "feature", keep_original_sound: "yes" })) } : {}), size: ratio, duration, resolution, sound: !videoUrls.length && boolConfig(config.videoGenerateAudio, true) ? "on" : "off", logo_add: boolConfig(config.videoWatermark, false) ? 1 : 0 };
    } else if (modelName === "KlingMotionControl") {
        userInput = { modelName, modelType, image_url: imageUrls[0], video_url: videoUrls[0], prompt, resolution, keep_original_sound: boolConfig(config.videoGenerateAudio, true) ? "yes" : "no", logo_add: boolConfig(config.videoWatermark, false) ? 1 : 0, character_orientation: "image" };
    } else if (modelName === "GoogleOmni") {
        userInput = { modelName, modelType, duration, prompt, images: imageUrls.join(","), video: videoUrls.join(","), size: normalizeVideoSize(config.size, config.vquality) || "1280x720" };
    } else {
        for (const [index, item] of content.filter((item) => item.type === "image_url").entries()) {
            if (modelType !== "mixVideo") item.role = index ? "last_frame" : "first_frame";
        }
        userInput = { modelName, modelType, content, ratio, resolution, duration, generate_audio: boolConfig(config.videoGenerateAudio, true), watermark: boolConfig(config.videoWatermark, false) };
    }
    const body = { ...(request.costType ? { cost_type: request.costType } : {}), ...(request.businessUrl ? { business_url: request.businessUrl, source: "0" } : {}), user_input: userInput };
    options?.signal?.throwIfAborted();
    options?.onProgress?.("素材已就绪，正在提交视频任务");
    try {
        const created = await createKexiangTask(config, body, options);
        if (!created.id) throw new Error(apiText("noVideoTaskId"));
        return { id: String(created.id), provider: "kexiang", model, baseUrl: config.baseUrl };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        throw videoRequestError(error, `可想AI创建视频任务失败（${modelName}）`);
    }
}

export async function pollKexiangVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = await queryKexiangTask(config, task.id, options);
        const status = (state.task_status || "").toLowerCase();
        if (["failed", "failure", "error", "cancelled", "canceled"].includes(status)) {
            const output = state.service_output as { failReason?: unknown } | null;
            const reason = readApiErrorMessage(output?.failReason) || state.errorMessage || readApiErrorMessage(state.error) || state.msg || apiText("videoGenerationFailed");
            return { status: "failed", error: `可想AI视频任务执行失败（任务 ${task.id}）：${reason}` };
        }
        const url = kexiangTaskUrls(state.service_output).find((value) => /\.mp4(?:[?#]|$)/i.test(value)) || kexiangTaskUrls(state.service_output)[0];
        if (url) return { status: "completed", result: { ...await videoResultFromUrl(url, options), sourceUrl: url } };
        if (["success", "succeeded", "completed"].includes(status)) return { status: "failed", error: apiText("noPlayableVideo") };
        return { status: "pending" };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        throw videoRequestError(error, `可想AI查询视频任务失败（任务 ${task.id}）`);
    }
}

