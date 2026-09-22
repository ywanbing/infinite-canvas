import { modelOptionName, resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";

export type ArkVideoMode = "text" | "first_frame" | "first_last_frame" | "reference" | "edit" | "extend";
export type ArkVideoModel = {
    name: string;
    modelId: string;
    modelPrefix: string;
    modes: ArkVideoMode[];
    resolutions: string[];
    ratios: Record<ArkVideoMode, string[]>;
    duration: { min: number; max: number; auto: boolean; default: number };
    supportsAudio: boolean;
    supportsAssets: boolean;
    defaultResolution: string;
    defaultRatio: string;
    defaultMode: ArkVideoMode;
    dimensions: Record<string, Record<string, string>>;
    mediaLimits: { images: number; videos: number; audios: number; audioOnly: boolean; minDuration: number; maxDuration: number; totalDuration: number; imageBytes: number; videoBytes: number; audioBytes: number };
};

const fixedRatios = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
const allRatios = ["adaptive", ...fixedRatios];
const dimensionRow = (values: string[]) => Object.fromEntries(fixedRatios.map((ratio, index) => [ratio, values[index]]));
const modernDimensions = {
    "480": dimensionRow(["864x496", "752x560", "640x640", "560x752", "496x864", "992x432"]),
    "720": dimensionRow(["1280x720", "1112x834", "960x960", "834x1112", "720x1280", "1470x630"]),
    "1080": dimensionRow(["1920x1080", "1664x1248", "1440x1440", "1248x1664", "1080x1920", "2206x946"]),
    "4k": dimensionRow(["3840x2160", "3326x2494", "2880x2880", "2494x3326", "2160x3840", "4398x1886"]),
};
const legacyDimensions = {
    "480": dimensionRow(["864x480", "736x544", "640x640", "544x736", "480x864", "960x416"]),
    "720": dimensionRow(["1248x704", "1120x832", "960x960", "832x1120", "704x1248", "1504x640"]),
    "1080": dimensionRow(["1920x1088", "1664x1248", "1440x1440", "1248x1664", "1088x1920", "2176x928"]),
};
const definitions = [
    ["2.5", "doubao-seedance-2-5-260628", ["480", "720", "1080"]],
    ["2.0 fast", "doubao-seedance-2-0-fast-260128", ["480", "720"]],
    ["2.0 mini", "doubao-seedance-2-0-mini-260615", ["480", "720"]],
    ["2.0", "doubao-seedance-2-0-260128", ["480", "720", "1080", "4k"]],
    ["1.5 Pro（即将下线）", "doubao-seedance-1-5-pro-251215", ["480", "720", "1080"]],
    ["1.0 pro fast", "doubao-seedance-1-0-pro-fast-251015", ["480", "720", "1080"]],
    ["1.0 pro", "doubao-seedance-1-0-pro-250528", ["480", "720", "1080"]],
] as const;

// 官方创建任务参数：https://docs.volcengine.com/docs/82379/1520757
export const arkVideoModels: ArkVideoModel[] = definitions.map(([name, modelId, resolutions]) => {
    const newest = name === "2.5", omni = name.startsWith("2."), legacy = name.startsWith("1.0");
    const modes: ArkVideoMode[] = ["text", "first_frame", ...(name === "1.0 pro fast" ? [] : ["first_last_frame" as const]), ...(omni ? ["reference" as const] : []), ...(newest ? ["edit" as const, "extend" as const] : [])];
    return {
        name: `豆包 Seedance ${name}`, modelId, modelPrefix: modelId.replace(/-\d{6}$/, ""), modes, resolutions: [...resolutions],
        ratios: { text: legacy ? fixedRatios : allRatios, first_frame: newest ? ["adaptive"] : allRatios, first_last_frame: newest ? ["adaptive"] : allRatios, reference: allRatios, edit: ["adaptive"], extend: ["adaptive"] },
        duration: { min: legacy ? 2 : 4, max: newest ? 30 : omni ? 15 : 12, auto: !legacy, default: newest ? -1 : 6 },
        supportsAudio: !legacy, supportsAssets: omni, defaultResolution: legacy ? "1080" : "720", defaultRatio: legacy ? "16:9" : "adaptive", defaultMode: "text",
        dimensions: Object.fromEntries(resolutions.map((resolution) => [resolution, legacy ? legacyDimensions[resolution as keyof typeof legacyDimensions] : newest && resolution === "480" ? { ...modernDimensions["480"], "16:9": "854x480", "9:16": "480x854" } : modernDimensions[resolution]])),
        mediaLimits: { images: newest ? 30 : omni ? 9 : 2, videos: newest ? 10 : omni ? 3 : 0, audios: newest ? 10 : omni ? 3 : 0, audioOnly: newest, minDuration: 2, maxDuration: newest ? 30 : 15, totalDuration: newest ? 30 : 15, imageBytes: 30 * 1024 ** 2, videoBytes: 200 * 1024 ** 2, audioBytes: 15 * 1024 ** 2 },
    };
});

// 展示名和无版本名称使用参数表中的 Model ID；显式版本不替换为默认版本。
export function resolveArkVideoModelId(name: string) {
    const id = modelOptionName(name).trim().toLowerCase().replace(/^(doubao-seedance-\d+)\.(\d+)(?=-|$)/, "$1-$2");
    return arkVideoModels.find((model) => id === model.modelPrefix)?.modelId || id;
}

const retiredAgentPlanModel = /^doubao-seedance-1(?:\.5|-5)-pro(?:-\d{6}|-即将下线)?$/i;

export function resolveArkVideoModel(name: string, accessMode?: string) {
    const id = resolveArkVideoModelId(name);
    if (accessMode === "agent-plan" && retiredAgentPlanModel.test(id)) return undefined;
    return arkVideoModels.find((model) => id === model.modelId || (id.startsWith(`${model.modelPrefix}-`) && /^\d{6}$/.test(id.slice(model.modelPrefix.length + 1))));
}

export function getArkVideoCapabilities(config: AiConfig) {
    const request = resolveModelRequestConfig(config, config.model || config.videoModel);
    return request.apiFormat === "ark" ? resolveArkVideoModel(request.model, request.arkAccessMode) : undefined;
}

export function validateArkVideoSettings(config: AiConfig) {
    const selected = config.model || config.videoModel;
    const request = resolveModelRequestConfig(config, selected);
    if (request.apiFormat !== "ark" || resolveModelScript(config, selected)) return "";
    if (request.arkAccessMode === "agent-plan" && retiredAgentPlanModel.test(modelOptionName(request.model).trim())) return "该 Seedance 1.5 Pro 模型已从 Agent Plan 下线，请选择当前套餐支持的模型。";
    const model = resolveArkVideoModel(request.model, request.arkAccessMode);
    if (!model) return "该 Ark 视频模型尚未内置适配，请选择已支持的模型或配置调用脚本。";
    const mode = config.videoMode as ArkVideoMode;
    if (!model.modes.includes(mode)) return `${model.name} 不支持当前生成模式，请重新选择。`;
    if (!model.resolutions.includes(config.vquality)) return `${model.name} 分辨率仅支持 ${model.resolutions.join(" / ")}。`;
    if (!model.ratios[mode].includes(config.size)) return `当前模式的比例仅支持 ${model.ratios[mode].join(" / ")}。`;
    const seconds = Number(config.videoSeconds);
    if (mode === "edit" && seconds !== -1) return "视频编辑必须使用智能时长（-1）。";
    if (!(seconds === -1 && model.duration.auto) && (!Number.isInteger(seconds) || seconds < model.duration.min || seconds > model.duration.max)) return `时长必须为 ${model.duration.min}–${model.duration.max} 整数秒${model.duration.auto ? "，或智能时长（-1）" : ""}。`;
    return "";
}
