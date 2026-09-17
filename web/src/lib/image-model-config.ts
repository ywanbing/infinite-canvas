import i18n from "@/i18n";
import { imageSizePresets, parseAspectRatio, parsePixelSize } from "./media-size";

export type ImageModelConfig = {
    name: string;
    apiFormat: string;
    model: RegExp;
    defaultScale: string;
    minPixels: number;
    maxPixels: number;
    maxRatio: number;
    presets: Record<string, Record<string, string>>;
};

// 图片生成尺寸，来源：https://docs.volcengine.com/docs/82379/1541523?lang=zh
// 不包含 Seedream 5.0 pro 的图层拆分场景。
const seedream1k = { "1:1": "1024x1024", "4:3": "1152x864", "3:4": "864x1152", "16:9": "1280x720", "9:16": "720x1280", "3:2": "1248x832", "2:3": "832x1248", "21:9": "1512x648" };
const seedream2k = { "1:1": "2048x2048", "4:3": "2304x1728", "3:4": "1728x2304", "16:9": "2848x1600", "9:16": "1600x2848", "3:2": "2496x1664", "2:3": "1664x2496", "21:9": "3136x1344" };
const seedream3k = { "1:1": "3072x3072", "4:3": "3456x2592", "3:4": "2592x3456", "16:9": "4096x2304", "9:16": "2304x4096", "3:2": "3744x2496", "2:3": "2496x3744", "21:9": "4704x2016" };
const seedream4k = { "1:1": "4096x4096", "4:3": "4704x3520", "3:4": "3520x4704", "16:9": "5504x3040", "9:16": "3040x5504", "3:2": "4992x3328", "2:3": "3328x4992", "21:9": "6240x2656" };
const seedreamDefaults = { apiFormat: "ark", defaultScale: "2k", minPixels: 3686400, maxPixels: 16777216, maxRatio: 16 };

// 新模型在这里配置匹配规则、分辨率预设和尺寸范围，面板与请求层共用。
export const imageModelConfigs: ImageModelConfig[] = [
    {
        ...seedreamDefaults,
        name: "Seedream 5.0 pro",
        model: /^doubao-seedream-5[.-]0-pro(?:-|$)/i,
        minPixels: 921600,
        maxPixels: 4624220,
        presets: {
            "1k": { "1:1": "1024x1024", "4:3": "1152x864", "3:4": "864x1152", "16:9": "1424x800", "9:16": "800x1424", "3:2": "1248x832", "2:3": "832x1248", "21:9": "1568x672" },
            "1.5k": { "1:1": "1536x1536", "4:3": "1792x1344", "3:4": "1344x1792", "16:9": "2048x1152", "9:16": "1152x2048", "3:2": "1872x1248", "2:3": "1248x1872", "21:9": "2352x1008" },
            "2k": { "1:1": "2048x2048", "4:3": "2368x1776", "3:4": "1776x2368", "16:9": "2816x1584", "9:16": "1584x2816", "3:2": "2496x1664", "2:3": "1664x2496", "21:9": "3136x1344" },
        },
    },
    { ...seedreamDefaults, name: "Seedream 5.0 lite", model: /^doubao-seedream-5[.-]0-lite(?:-|$)/i, presets: { "2k": seedream2k, "3k": seedream3k, "4k": seedream4k } },
    { ...seedreamDefaults, name: "Seedream 4.5", model: /^doubao-seedream-4[.-]5(?:-|$)/i, presets: { "2k": seedream2k, "4k": seedream4k } },
    { ...seedreamDefaults, name: "Seedream 4.0", model: /^doubao-seedream-4[.-]0(?:-|$)/i, minPixels: 921600, presets: { "1k": seedream1k, "2k": seedream2k, "4k": seedream4k } },
];

const presetRatios = new Map([imageSizePresets, ...imageModelConfigs.map((config) => config.presets)]
    .flatMap((presets) => Object.values(presets).flatMap((ratios) => Object.entries(ratios).map(([ratio, size]) => [size, ratio] as const))));

export function getImageModelConfig(apiFormat: string, model: string) {
    return imageModelConfigs.find((config) => config.apiFormat === apiFormat && config.model.test(model.trim()));
}

function sizeError(key: string, config: ImageModelConfig, values?: Record<string, unknown>) {
    return i18n.t(`imageModelSize.${key}`, { model: config.name, min: config.minPixels, max: config.maxPixels, ratio: config.maxRatio, ...values });
}

export function computeModelImageSize(config: ImageModelConfig, scale: string, ratio: string) {
    const resolution = scale === "auto" ? config.defaultScale : scale.toLowerCase();
    if (!Object.hasOwn(config.presets, resolution)) throw new Error(sizeError("unsupportedScale", config, { scale, scales: Object.keys(config.presets).join(" / ").toUpperCase() }));
    if (ratio === "auto") return resolution.toUpperCase();
    const parsed = parseAspectRatio(ratio);
    if (!parsed || !Number.isFinite(parsed.width / parsed.height)) throw new Error(sizeError("invalidFormat", config));
    const preset = config.presets[resolution][ratio];
    if (preset) return preset;
    // 自定义比例按所选分辨率的正方形总像素计算；标准比例始终使用文档预设。
    const square = parsePixelSize(config.presets[resolution]["1:1"])!;
    const pixels = square.width * square.height;
    return `${Math.floor(Math.sqrt(pixels * parsed.width / parsed.height))}x${Math.floor(Math.sqrt(pixels * parsed.height / parsed.width))}`;
}

export function resolveModelImageSize(config: ImageModelConfig, size: string): string {
    const value = size.trim().toLowerCase();
    if (!value || value === "auto") return config.defaultScale.toUpperCase();
    if (/^\d+(?:\.\d+)?k$/.test(value)) return computeModelImageSize(config, value, "auto");
    const dimensions = parsePixelSize(value);
    if (!dimensions) {
        if (parseAspectRatio(value)) return resolveModelImageSize(config, computeModelImageSize(config, config.defaultScale, value));
        throw new Error(sizeError("invalidFormat", config));
    }
    const { width, height } = dimensions;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error(sizeError("invalidFormat", config));
    const pixels = width * height;
    if (pixels < config.minPixels || pixels > config.maxPixels) throw new Error(sizeError("pixels", config, { width, height, pixels }));
    if (Math.max(width / height, height / width) > config.maxRatio) throw new Error(sizeError("ratio", config));
    return `${width}x${height}`;
}

export function modelImageSizeError(config: ImageModelConfig, size: string) {
    try {
        resolveModelImageSize(config, size);
        return "";
    } catch (error) {
        return (error as Error).message;
    }
}

export function readModelImageSize(config: ImageModelConfig, size: string) {
    const value = size.trim().toLowerCase();
    if (!value || value === "auto" || /^\d+(?:\.\d+)?k$/.test(value)) {
        return { scale: !value || value === "auto" ? "auto" : value, ratio: "auto", width: 0, height: 0 };
    }
    const dimensions = parsePixelSize(value);
    if (dimensions) {
        for (const [scale, presets] of Object.entries(config.presets)) {
            const preset = Object.entries(presets).find(([, pixels]) => pixels === value);
            if (preset) return { scale, ratio: preset[0], ...dimensions };
        }
        const ratio = presetRatios.get(value) || Object.keys(config.presets[config.defaultScale]).find((ratio) => {
            const parsed = parseAspectRatio(ratio)!;
            return dimensions.width * parsed.height === dimensions.height * parsed.width;
        }) || `${dimensions.width}:${dimensions.height}`;
        return { scale: "custom", ratio, ...dimensions };
    }
    const ratio = parseAspectRatio(value) ? value : "1:1";
    const pixels = parsePixelSize(computeModelImageSize(config, config.defaultScale, ratio))!;
    return { scale: config.defaultScale, ratio, ...pixels };
}
