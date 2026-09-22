import type { ChannelModel, ModelChannel } from "@/stores/use-config-store";

export const kexiangVideoModeLabels = {
    text2video: "文生视频",
    img2video: "图生视频",
    mixVideo: "全能参考",
    frame2video: "首尾帧生视频",
    motionControl: "动作控制",
};
export type KexiangVideoMode = keyof typeof kexiangVideoModeLabels;
const fullVideoModes: KexiangVideoMode[] = ["text2video", "img2video", "mixVideo", "frame2video"];

export type KexiangModelRequest = {
    businessUrl?: string;
    modelType: string;
    imageField?: "urls" | "image_urls";
    costType?: number;
    assetAudit?: boolean;
    resolutions?: Array<{ value: string; label: string }>;
    videoModes?: KexiangVideoMode[];
    referenceAudio?: boolean;
};

type KexiangModel = ChannelModel & { modelId: string; request: KexiangModelRequest };

// Names are for display; modelId is the exact user_input.modelName from the provider docs.
// Only models created through /user_task/asyncCreateWithCost belong in this template.
const models: KexiangModel[] = [
    { name: "GPT-Image-2.5 / Sunburst", modelId: "GPT-Image-2.5-Sunburst", capability: "image", request: { modelType: "img2img", imageField: "image_urls" } },
    { name: "GPT-Image-2.5 / Flare", modelId: "GPT-Image-2.5-Flare", capability: "image", request: { modelType: "img2img", imageField: "image_urls" } },
    { name: "GPT-Image-2（渠道版）", modelId: "GPT-Image-2", capability: "image", request: { modelType: "img2img", imageField: "urls", costType: 1 } },
    { name: "GPT-Image-2（官方）", modelId: "GPT-Image-2-Official", capability: "image", request: { modelType: "img2img", imageField: "image_urls" } },
    { name: "Gemini 3.1 Flash Image / Nano Banana 2", modelId: "gemini-3.1-flash-image", capability: "image", request: { modelType: "img2img", imageField: "image_urls" } },
    { name: "Gemini 3 Pro Image / Nano Banana Pro", modelId: "gemini-3-pro-image", capability: "image", request: { modelType: "img2img", imageField: "image_urls" } },
    // modelType sources: api.mathmind.cn/{513443300,499638158,442053340}e0
    { name: "MiniMax-H3", modelId: "MiniMaxH3", capability: "video", request: { modelType: "mixVideo", videoModes: fullVideoModes, referenceAudio: true, resolutions: [{ value: "768", label: "768P" }, { value: "2048", label: "2K" }] } },
    { name: "Seedance 2.5", modelId: "KVideo2.5", capability: "video", request: { modelType: "mixVideo", videoModes: fullVideoModes, referenceAudio: true, assetAudit: true } },
    { name: "Seedance 2.0-Fast", modelId: "KVideo2.0-Fast", capability: "video", request: { modelType: "mixVideo", videoModes: fullVideoModes, referenceAudio: true, assetAudit: true } },
    { name: "Seedance 2.0", modelId: "KVideo2.0", capability: "video", request: { modelType: "mixVideo", videoModes: fullVideoModes, referenceAudio: true, assetAudit: true } },
    { name: "Seedance 2.0-Mini", modelId: "KVideo2.0-Mini", capability: "video", request: { modelType: "mixVideo", videoModes: fullVideoModes, referenceAudio: true, assetAudit: true } },
    // Kling: 460029105; Omni: 460057895,468284947,468299708,468291762; Motion: 460163820.
    { name: "Kling V3", modelId: "KlingV3", capability: "video", request: { modelType: "img2video", videoModes: ["text2video", "img2video", "frame2video"], businessUrl: "kling/i2v", costType: 3 } },
    { name: "Kling V3 Omni", modelId: "Kling-v3-omni", capability: "video", request: { modelType: "mixVideo", videoModes: fullVideoModes, businessUrl: "kling/video-edit", costType: 3 } },
    { name: "Kling V3 Motion Control", modelId: "KlingMotionControl", capability: "video", request: { modelType: "motionControl", videoModes: ["motionControl"], businessUrl: "kling/motion-control", costType: 3 } },
    // KGG-Omni: api.mathmind.cn/479207222e0
    { name: "KGG-Omni", modelId: "GoogleOmni", capability: "video", request: { modelType: "text2video", videoModes: ["text2video", "img2video", "mixVideo"] } },
];

export function resolveKexiangModelRequest(modelId: string): KexiangModelRequest | undefined {
    return models.find((model) => model.modelId === modelId.trim())?.request;
}

export function validateKexiangVideoMode(modelId: string, mode: string) {
    const modes = resolveKexiangModelRequest(modelId)?.videoModes;
    return modes?.some((value) => value === mode) ? "" : "请在视频设置中选择当前可想AI模型支持的生成模式。";
}

export function kexiangChannelModel(modelId: string): ChannelModel {
    const id = modelId.trim();
    const known = models.find((model) => model.modelId === id);
    return { name: known?.name || id, modelId: id, capability: known?.capability || "text" };
}

export function isKexiangSeedanceModel(modelId: string) {
    return Boolean(resolveKexiangModelRequest(modelId)?.assetAudit);
}

export const defaultKexiangChannel: Omit<ModelChannel, "id" | "name"> = {
    baseUrl: "https://kexiangai.com",
    apiKey: "",
    apiFormat: "kexiang",
    models: models.map(({ name, modelId, capability }) => ({ name, modelId, capability })),
};

export function defaultKexiangModels() {
    return defaultKexiangChannel.models.map((model) => ({ ...model }));
}
