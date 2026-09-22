import type { ReferenceImage } from "@/types/image";

export function imageReferenceUrlExpiresAt(url: string) {
    return /^https?:\/\//i.test(url) ? Date.now() + 24 * 60 * 60 * 1000 : undefined;
}

export function imageReferenceRemoteUrl(image: Pick<ReferenceImage, "url" | "urlExpiresAt" | "dataUrl">) {
    const url = image.url || image.dataUrl;
    if (/^asset:\/\//i.test(url)) return url;
    if (/^https?:\/\//i.test(url) && (image.urlExpiresAt === undefined || image.urlExpiresAt > Date.now())) return url;
    return undefined;
}
