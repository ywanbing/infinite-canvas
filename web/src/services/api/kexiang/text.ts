import axios from "axios";
import i18n from "@/i18n";
import { kexiangChannelModel } from "@/lib/kexiang-models";
import type { AiConfig, ChannelModel } from "@/stores/use-config-store";
import { readAxiosError, type RequestOptions } from "../request-utils";
import { kexiangApiUrl, kexiangTextHeaders } from "./client";

export async function fetchKexiangModelIds(config: Pick<AiConfig, "baseUrl" | "apiKey">) {
    const response = await axios.get<{ list?: Array<{ model?: string }> }>(kexiangApiUrl(config, "/models"), { headers: kexiangTextHeaders(config) });
    return (response.data.list || []).map((item) => item.model).filter((id): id is string => Boolean(id)).sort((a, b) => a.localeCompare(b));
}

export async function fetchKexiangModels(config: Pick<AiConfig, "baseUrl" | "apiKey">): Promise<ChannelModel[]> {
    try {
        return (await fetchKexiangModelIds(config)).map(kexiangChannelModel);
    } catch (error) {
        throw new Error(readAxiosError(error, i18n.t("apiErrors.modelReadFailed")));
    }
}

export function requestKexiangTextResponse(config: AiConfig, body: Record<string, unknown>, options?: RequestOptions) {
    return fetch(kexiangApiUrl(config, "/responses"), {
        method: "POST",
        headers: { ...kexiangTextHeaders(config), "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ ...body, stream: true }),
        signal: options?.signal,
    });
}
