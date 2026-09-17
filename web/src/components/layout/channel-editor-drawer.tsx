import { Button, Drawer, Input, Segmented, Select, Space, Switch } from "antd";
import { ListPlus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { defaultArkImageOptions, defaultBaseUrlForApiFormat, guessCapability, normalizeChannelModels, type ApiCallFormat, type ArkImageOptions, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { ModelScriptEditor } from "./model-script-editor";
import { ModelSelectModal } from "./model-select-modal";
import { arkAccessConfig, arkAccessModes, type ArkAccessMode } from "@/lib/ark-channel-config";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
        { label: t("config.channelEditor.ark"), value: "ark" },
    ];
    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = ["image", "video", "text", "audio"].map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value: value as ModelCapability }));

    useEffect(() => {
        if (open && channel) setDraft(channel);
    }, [open, channel]);

    if (!draft) return null;

    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const arkOptions = draft.arkImageOptions || defaultArkImageOptions;
    const patchArkOptions = (value: Partial<ArkImageOptions>) => patch({ arkImageOptions: { ...arkOptions, ...value } });
    const setModels = (models: ChannelModel[]) => patch({ models });

    const changeApiFormat = (apiFormat: ApiCallFormat) => {
        const previousDefault = draft.apiFormat === "ark" ? arkAccessConfig(draft.arkAccessMode).baseUrl : defaultBaseUrlForApiFormat(draft.apiFormat);
        const baseUrl = !draft.baseUrl.trim() || draft.baseUrl.trim().replace(/\/+$/, "") === previousDefault ? defaultBaseUrlForApiFormat(apiFormat) : draft.baseUrl;
        patch({ apiFormat, baseUrl, arkAccessMode: apiFormat === "ark" ? "api" : undefined });
    };

    const changeArkAccess = (arkAccessMode: ArkAccessMode) => {
        const isDefault = !draft.baseUrl.trim() || arkAccessModes.some((item) => item.baseUrl === draft.baseUrl.trim().replace(/\/+$/, ""));
        patch({ arkAccessMode, ...(isDefault ? { baseUrl: arkAccessConfig(arkAccessMode).baseUrl } : {}) });
    };

    const applySelection = (names: string[]) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        setModels(names.map((name) => map.get(name) || { name, capability: guessCapability(name) }));
    };

    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));

    const save = () => {
        onSave({ ...draft, name: draft.name.trim() || t("config.channels.unnamed"), models: normalizeChannelModels(draft.models) });
        onClose();
    };

    return (
        <Drawer
            open={open}
            width={640}
            title={t("config.channelEditor.title")}
            onClose={onClose}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" onClick={save}>
                        {t("common.save")}
                    </Button>
                </Space>
            }
        >
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.name")}</span>
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.protocol")}</span>
                    <Select className="w-full" value={draft.apiFormat} options={apiFormatOptions} onChange={changeApiFormat} />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.baseUrl")}</span>
                    <Input value={draft.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://api.example.com" />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">API Key</span>
                    <Input.Password value={draft.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} placeholder="sk-..." />
                </label>
            </div>

            {draft.apiFormat === "ark" && (
                <div className="mt-6 space-y-4">
                    <label className="block">
                        <span className="mb-1 block text-sm font-semibold">接入方式</span>
                        <Select aria-label="Ark 接入方式" className="w-full" value={draft.arkAccessMode || "api"} options={[...arkAccessModes]} onChange={changeArkAccess} />
                    </label>
                    <div className="text-xs opacity-60">请使用所选方式对应的 API Key。切换方式会更新默认地址，自定义地址保留；模型统一在下方“渠道模型”中配置。</div>
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold">{t("config.channelEditor.arkImageOptions")}</span>
                        <a href="https://docs.volcengine.com/docs/82379/1541523?lang=zh" target="_blank" rel="noreferrer" className="text-xs">{t("config.channelEditor.arkDocs")}</a>
                    </div>
                    <div className="text-xs opacity-60">{t("config.channelEditor.arkHint")}</div>
                    <div className="text-xs opacity-60">{t("config.channelEditor.arkSizeHint")}</div>
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-sm">{t("config.channelEditor.arkWatermark")}</span>
                        <Switch aria-label={t("config.channelEditor.arkWatermark")} checked={arkOptions.watermark} onChange={(watermark) => patchArkOptions({ watermark })} />
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <span className="mb-1 block text-sm">{t("config.channelEditor.arkOutputFormat")}</span>
                            <Select className="w-full" aria-label={t("config.channelEditor.arkOutputFormat")} value={arkOptions.outputFormat} onChange={(outputFormat) => patchArkOptions({ outputFormat })} options={[{ value: "auto", label: t("config.channelEditor.arkModelDefault") }, { value: "png", label: "PNG" }, { value: "jpeg", label: "JPEG" }]} />
                            <div className="mt-1 text-xs opacity-60">{t("config.channelEditor.arkOutputFormatHint")}</div>
                        </div>
                        <div>
                            <span className="mb-1 block text-sm">{t("config.channelEditor.arkPromptMode")}</span>
                            <Select className="w-full" aria-label={t("config.channelEditor.arkPromptMode")} value={arkOptions.promptMode} onChange={(promptMode) => patchArkOptions({ promptMode })} options={[{ value: "auto", label: t("config.channelEditor.arkModelDefault") }, { value: "standard", label: t("config.channelEditor.arkStandard") }, { value: "fast", label: t("config.channelEditor.arkFast") }]} />
                            <div className="mt-1 text-xs opacity-60">{t("config.channelEditor.arkPromptModeHint")}</div>
                        </div>
                    </div>
                </div>
            )}

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                    <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.modelDescription", { count: draft.models.length })}</div>
                </div>
                <Button type="primary" icon={<ListPlus className="size-4" />} onClick={() => setSelectOpen(true)}>
                    {t("config.channelEditor.selectModels")}
                </Button>
            </div>

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {draft.models.length ? (
                    draft.models.map((model) => (
                        <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                            <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>
                                {model.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                                <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                    {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}
                                </Button>
                                <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-stone-500">{t("config.channelEditor.empty")}</div>
                )}
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />
        </Drawer>
    );
}
