import axios from "axios";
import { withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import type { RequestOptions } from "../request-utils";

export function kexiangHeaders(config: Pick<AiConfig, "apiKey">, contentType?: string) {
    return { "x-api-key": config.apiKey.trim(), ...(contentType ? { "Content-Type": contentType } : {}) };
}

export function kexiangApiUrl(config: Pick<AiConfig, "baseUrl">, path: string) {
    return withLocalProxy(`${config.baseUrl.trim().replace(/\/+$/, "")}/api/v1${path}`);
}

export function kexiangTextHeaders(config: Pick<AiConfig, "apiKey">) {
    const key = config.apiKey.trim();
    return { Authorization: `Bearer ${key.startsWith("sk-") ? key : `sk-${key}`}` };
}

export type KexiangTaskPayload = {
    id?: string | number;
    task_status?: string;
    service_output?: unknown;
    msg?: string;
    error?: unknown;
    errorMessage?: string;
    data?: KexiangTaskPayload;
};

export function kexiangTaskData(payload: KexiangTaskPayload) {
    // A task's own `data` contains upstream details, not another task envelope.
    return payload?.id !== undefined || payload?.task_status ? payload : payload.data || payload;
}

export function kexiangTaskUrls(value: unknown): string[] {
    if (typeof value === "string") return /^(?:https?:\/\/|asset:\/\/|data:)/i.test(value) ? [value] : [];
    if (Array.isArray(value)) return value.flatMap(kexiangTaskUrls);
    if (!value || typeof value !== "object") return [];
    return Object.values(value).flatMap(kexiangTaskUrls);
}

export async function createKexiangTask(config: AiConfig, body: Record<string, unknown>, options?: RequestOptions) {
    return kexiangTaskData((await axios.post<KexiangTaskPayload>(kexiangApiUrl(config, "/user_task/asyncCreateWithCost"), body, { headers: kexiangHeaders(config, "application/json"), signal: options?.signal })).data);
}

export async function queryKexiangTask(config: AiConfig, id: string, options?: RequestOptions) {
    return kexiangTaskData((await axios.get<KexiangTaskPayload>(kexiangApiUrl(config, `/user_task/get/passAuth/${encodeURIComponent(id)}`), { headers: kexiangHeaders(config), signal: options?.signal })).data);
}
