import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { isObjectStorageConfig, isObjectStorageProfiles, type ObjectStorageConfig, type ObjectStorageProfiles } from "@/services/api/s3/config";
import { useConfigStore, type AiConfig, type WebdavSyncConfig } from "@/stores/use-config-store";
import { usePromptSourceStore, type PromptSourceSchedule } from "@/stores/use-prompt-source-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";

type AppConfigFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    config: AiConfig;
    webdav: WebdavSyncConfig;
    objectStorage: ObjectStorageConfig;
    objectStorageProfiles: ObjectStorageProfiles;
    promptSources: {
        sources: PromptSource[];
        schedule: PromptSourceSchedule;
    };
};

export function exportAppConfig() {
    const { config, webdav, objectStorage, objectStorageProfiles } = useConfigStore.getState();
    const { sources, schedule } = usePromptSourceStore.getState();
    const data: AppConfigFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), config, webdav, objectStorage, objectStorageProfiles, promptSources: { sources, schedule } };
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), "infinite-canvas-config.json");
}

export async function importAppConfig(file: File) {
    let data: AppConfigFile;
    try {
        data = JSON.parse(await file.text()) as AppConfigFile;
    } catch {
        throw new Error(i18n.t("config.invalidFile"));
    }
    if (!data || data.app !== "infinite-canvas" || data.version !== 1 || !data.config || !data.webdav || !data.promptSources || !isObjectStorageConfig(data.objectStorage) || !isObjectStorageProfiles(data.objectStorageProfiles) || Object.hasOwn(data.objectStorageProfiles, data.objectStorage.provider)) throw new Error(i18n.t("config.invalidFile"));
    useConfigStore.setState({ config: data.config, webdav: data.webdav, objectStorage: data.objectStorage, objectStorageProfiles: data.objectStorageProfiles });
    usePromptSourceStore.setState(data.promptSources);
}
