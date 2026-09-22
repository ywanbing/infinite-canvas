import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { resolveKexiangModelRequest } from "@/lib/kexiang-models";
import { inferMediaRatio } from "@/lib/media-size";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { imageReferenceUrlExpiresAt } from "@/lib/image-reference-url";
import { delay, readAxiosError, type RequestOptions } from "../request-utils";
import { createKexiangTask, queryKexiangTask, kexiangTaskUrls } from "./client";

const apiText = (key: string) => i18n.t(`apiErrors.${key}`);

function kexiangImageQuality(value: string) {
    const normalized = value.trim().toLowerCase();
    return ["medium", "2k"].includes(normalized) ? "medium" : ["high", "4k"].includes(normalized) ? "high" : "low";
}

function kexiangImageResolution(value: string) {
    const normalized = value.trim().toLowerCase();
    return ["medium", "2k"].includes(normalized) ? "2k" : ["high", "4k"].includes(normalized) ? "4k" : "1k";
}

function kexiangImageReferenceUrl(image: ReferenceImage) {
    const url = image.url || image.dataUrl || "";
    if (/^(?:https?:\/\/|asset:\/\/).+/i.test(url)) return url;
    throw new Error(`${image.name || "参考图"} 需要公网 HTTP(S) 地址或 asset:// 素材 ID。`);
}

async function requestKexiangImage(config: AiConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const request = resolveKexiangModelRequest(config.model);
    if (!request) throw new Error(`可想AI未配置模型 ${config.model} 的请求映射。`);
    const userInput = {
        modelType: references.length ? request.modelType : "text2img",
        modelName: config.model,
        prompt: config.systemPrompt.trim() ? `${config.systemPrompt.trim()}\n\n${prompt}` : prompt,
        quality: kexiangImageQuality(config.quality),
        resolution: kexiangImageResolution(config.quality),
        size: config.size && config.size !== "auto" ? inferMediaRatio(config.size) : "1:1",
        ...(references.length ? { [request.imageField || "image_urls"]: references.map(kexiangImageReferenceUrl) } : {}),
    };
    const body = {
        ...(request.costType ? { cost_type: request.costType } : {}),
        user_input: userInput,
    };
    try {
        const created = await createKexiangTask(config, body, options);
        if (!created.id) throw new Error(apiText("requestFailed"));
        for (let attempt = 0; attempt < 120; attempt += 1) {
            const state = await queryKexiangTask(config, String(created.id), options);
            const status = (state.task_status || "").toLowerCase();
            if (["failed", "failure", "error", "cancelled", "canceled"].includes(status)) throw new Error(state.errorMessage || state.msg || apiText("noImageReturned"));
            const urls = kexiangTaskUrls(state.service_output);
            if (urls.length) return { id: nanoid(), dataUrl: urls[0], url: urls[0], urlExpiresAt: imageReferenceUrlExpiresAt(urls[0]) };
            if (["success", "succeeded", "completed"].includes(status)) throw new Error(apiText("noImageReturned"));
            if (attempt === 119) throw new Error(apiText("imageTimeout"));
            await delay(2500, options?.signal);
        }
        throw new Error(apiText("imageTimeout"));
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("requestFailed")));
    }
}

export async function requestKexiangImages(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, options?: RequestOptions) {
    return Promise.all(Array.from({ length: count }, () => requestKexiangImage(config, prompt, references, options)));
}

