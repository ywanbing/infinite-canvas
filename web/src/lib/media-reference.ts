import type { MediaReferenceInput } from "@/types/media-reference";

export const ARK_MEDIA_EXEMPTION_MS = 30 * 24 * 60 * 60 * 1000;

export function isArkMediaExempt(item: MediaReferenceInput, now = Date.now()) {
    const generatedAt = item.mediaSource?.generatedAt;
    return item.mediaSource?.origin === "ark" && typeof generatedAt === "number" && Number.isFinite(generatedAt) && generatedAt > 0 && generatedAt <= now && now < generatedAt + ARK_MEDIA_EXEMPTION_MS;
}

export function mediaReferenceSource(item: MediaReferenceInput) {
    return item.referenceUrl || item.mediaSource?.originalUrl || item.url || item.dataUrl || "";
}

export function mediaReferenceKey(item: MediaReferenceInput) {
    const value = item.mediaSource?.id
        ? item.mediaSource.id
        : item.arkAssetSource
          ? item.arkAssetSource
          : item.storageKey
            ? item.storageKey
            : item.mediaSource?.originalUrl || ([item.referenceUrl, item.url, item.dataUrl].find((value) => /^(?:https?:\/\/|asset:\/\/)/i.test(value || "")) || "");
    if (!value || /^(?:blob:|data:)/i.test(value)) throw new Error("素材缺少可持久识别的来源，无法安全复用审核结果。");
    return value;
}

export function isPublicMediaUrl(value: string) {
    try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol)) return false;
        const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        return host !== "localhost" && host !== "0.0.0.0" && host !== "::1" && !/^127\./.test(host) && !/^10\./.test(host) && !/^192\.168\./.test(host) && !/^169\.254\./.test(host) && !/^172\.(1[6-9]|2\d|3[01])\./.test(host);
    } catch {
        return false;
    }
}
