import { Alert, Button, Drawer, Input, Modal, Segmented, Select, Space, Switch } from "antd";
import { ListPlus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { defaultArkImageOptions, defaultBaseUrlForApiFormat, normalizeChannelModels, type ApiCallFormat, type ArkImageOptions, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { defaultKexiangModels } from "@/lib/kexiang-models";
import { ModelScriptEditor } from "./model-script-editor";
import { ModelSelectModal } from "./model-select-modal";
import { arkAccessConfig, arkAccessModes, type ArkAccessMode, type ArkAssetConfig } from "@/lib/ark-channel-config";
import { createArkAssetGroup, listArkAssetGroups, type ArkAssetGroup } from "@/services/api/ark/assets";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [arkGroups, setArkGroups] = useState<ArkAssetGroup[] | null>(null);
    const [arkGroupsLoading, setArkGroupsLoading] = useState(false);
    const [arkGroupsError, setArkGroupsError] = useState("");
    const arkGroupsRequest = useRef<AbortController | null>(null);
    const [newArkGroup, setNewArkGroup] = useState<{ name: string; description: string } | null>(null);
    const [arkGroupCreating, setArkGroupCreating] = useState(false);
    const [arkGroupCreateError, setArkGroupCreateError] = useState("");
    const arkGroupCreateRequest = useRef<AbortController | null>(null);
    const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
        { label: t("config.channelEditor.ark"), value: "ark" },
        { label: "可想AI", value: "kexiang" },
    ];
    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = ["image", "video", "text", "audio"].map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value: value as ModelCapability }));

    useEffect(() => {
        if (open && channel) setDraft(channel);
    }, [open, channel]);

    useEffect(() => {
        arkGroupsRequest.current?.abort();
        setArkGroups(null);
        setArkGroupsLoading(false);
        setArkGroupsError("");
        setNewArkGroup(null);
        setArkGroupCreating(false);
        setArkGroupCreateError("");
        return () => { arkGroupsRequest.current?.abort(); arkGroupCreateRequest.current?.abort(); };
    }, [open, draft?.id, draft?.apiFormat, draft?.arkAssets?.accessKeyId, draft?.arkAssets?.secretAccessKey, draft?.arkAssets?.projectName]);

    if (!draft) return null;

    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const arkOptions = draft.arkImageOptions || defaultArkImageOptions;
    const patchArkOptions = (value: Partial<ArkImageOptions>) => patch({ arkImageOptions: { ...arkOptions, ...value } });
    const patchArkAssets = (value: Partial<ArkAssetConfig>) => patch({ arkAssets: { accessKeyId: "", secretAccessKey: "", groupId: "", projectName: "default", ...draft.arkAssets, ...value, ...("groupId" in value ? {} : { groupId: "" }) } });
    const arkGroupsReady = Boolean(draft.arkAssets?.accessKeyId.trim() && draft.arkAssets?.secretAccessKey.trim());
    const loadArkGroups = async (created?: ArkAssetGroup) => {
        if (!draft.arkAssets || !arkGroupsReady || arkGroupsLoading) return;
        const controller = new AbortController();
        arkGroupsRequest.current = controller;
        setArkGroupsLoading(true);
        setArkGroupsError("");
        if (!created) setArkGroups(null);
        try {
            const groups = await listArkAssetGroups(draft.arkAssets, { signal: controller.signal });
            if (!controller.signal.aborted) {
                if (created && !groups.some((group) => group.Id === created.Id)) groups.push(created);
                setArkGroups(groups);
                setDraft((current) => current?.arkAssets?.groupId && !groups.some((group) => group.Id === current.arkAssets?.groupId)
                    ? { ...current, arkAssets: { ...current.arkAssets, groupId: "" } } : current);
            }
        } catch (error) {
            if (!controller.signal.aborted) setArkGroupsError(error instanceof Error ? error.message : "素材组列表读取失败");
        } finally {
            if (!controller.signal.aborted) setArkGroupsLoading(false);
        }
    };
    const openArkGroupCreate = () => { setNewArkGroup({ name: "", description: "" }); setArkGroupCreateError(""); };
    const submitArkGroup = async () => {
        if (!draft.arkAssets || !newArkGroup?.name.trim() || arkGroupCreating || (arkGroupCreateRequest.current && !arkGroupCreateRequest.current.signal.aborted)) return;
        const controller = new AbortController();
        arkGroupCreateRequest.current = controller;
        arkGroupsRequest.current?.abort();
        setArkGroupsLoading(false);
        setArkGroupCreating(true);
        setArkGroupCreateError("");
        try {
            const { Id } = await createArkAssetGroup(draft.arkAssets, newArkGroup, { signal: controller.signal });
            if (controller.signal.aborted) return;
            const group: ArkAssetGroup = { Id, Name: newArkGroup.name.trim(), GroupType: "AIGC" };
            setArkGroups((groups) => [...(groups || []), group]);
            patchArkAssets({ groupId: Id });
            setNewArkGroup(null);
            await loadArkGroups(group);
        } catch (error) {
            if (!controller.signal.aborted) setArkGroupCreateError(error instanceof Error ? error.message : "素材组创建失败");
        } finally {
            if (!controller.signal.aborted) setArkGroupCreating(false);
            if (arkGroupCreateRequest.current === controller) arkGroupCreateRequest.current = null;
        }
    };
    const setModels = (models: ChannelModel[]) => patch({ models });

    const changeApiFormat = (apiFormat: ApiCallFormat) => {
        const previousDefault = draft.apiFormat === "ark" ? arkAccessConfig(draft.arkAccessMode).baseUrl : defaultBaseUrlForApiFormat(draft.apiFormat);
        const baseUrl = !draft.baseUrl.trim() || draft.baseUrl.trim().replace(/\/+$/, "") === previousDefault ? defaultBaseUrlForApiFormat(apiFormat) : draft.baseUrl;
        patch({ apiFormat, baseUrl, arkAccessMode: apiFormat === "ark" ? "api" : undefined, ...(apiFormat === "kexiang" && draft.apiFormat !== "kexiang" ? { models: defaultKexiangModels() } : {}) });
    };

    const changeArkAccess = (arkAccessMode: ArkAccessMode) => {
        const isDefault = !draft.baseUrl.trim() || arkAccessModes.some((item) => item.baseUrl === draft.baseUrl.trim().replace(/\/+$/, ""));
        patch({ arkAccessMode, ...(isDefault ? { baseUrl: arkAccessConfig(arkAccessMode).baseUrl } : {}) });
    };

    const applySelection = (selectedModels: ChannelModel[]) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        setModels(selectedModels.map((model) => ({ ...model, ...map.get(model.name), modelId: map.get(model.name)?.modelId || model.modelId })));
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
                        <span className="text-sm font-semibold">官方素材审核（可选）</span>
                        <a href="https://www.volcengine.com/docs/82379/2333565" target="_blank" rel="noreferrer" className="text-xs">素材库文档</a>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                        <label className="block"><span className="mb-1 block text-sm">Access Key ID</span><Input value={draft.arkAssets?.accessKeyId || ""} onChange={(event) => patchArkAssets({ accessKeyId: event.target.value })} autoComplete="off" /></label>
                        <label className="block"><span className="mb-1 block text-sm">Secret Access Key</span><Input.Password value={draft.arkAssets?.secretAccessKey || ""} onChange={(event) => patchArkAssets({ secretAccessKey: event.target.value })} autoComplete="new-password" /></label>
                        <label className="block"><span className="mb-1 block text-sm">项目名称</span><Input value={draft.arkAssets?.projectName ?? "default"} onChange={(event) => patchArkAssets({ projectName: event.target.value })} placeholder="default" /></label>
                        <div className="md:col-span-2">
                            <div className="mb-1 flex items-center justify-between"><span className="text-sm">素材组</span><Space size={0}><Button type="text" size="small" disabled={!arkGroupsReady || arkGroupCreating || arkGroupsLoading} onClick={openArkGroupCreate}>创建素材组</Button><Button type="text" size="small" disabled={!arkGroupsReady || arkGroupCreating} loading={arkGroupsLoading} onClick={() => void loadArkGroups()}>刷新素材组</Button></Space></div>
                            <Select aria-label="素材组" className="w-full" showSearch optionFilterProp="label" allowClear disabled={!arkGroupsReady} value={draft.arkAssets?.groupId || undefined} loading={arkGroupsLoading}
                                onOpenChange={(visible) => { if (visible && arkGroups === null && !arkGroupsError) void loadArkGroups(); }}
                                onChange={(groupId) => patchArkAssets({ groupId: groupId || "" })}
                                options={(arkGroups || []).map((group) => ({ value: group.Id, label: `${group.Name || group.Id} · ${group.GroupType === "LivenessFace" ? "真人素材" : "虚拟人像"}（${group.Id}）` }))}
                                placeholder={arkGroupsReady ? "选择素材组" : "请先填写审核 AK/SK"}
                                notFoundContent={arkGroupsLoading ? "正在读取素材组…" : arkGroupsError ? "读取失败，请点击刷新重试" : arkGroups === null ? "打开下拉框读取素材组" : arkGroups.length ? "没有匹配的素材组" : "当前项目没有素材组，请先创建"} />
                        </div>
                    </div>
                    {arkGroupsError && <Alert type="error" showIcon title="素材组列表读取失败" description={arkGroupsError} />}
                    {arkGroups?.length === 0 && <Alert type="info" showIcon title="当前项目还没有素材组" description={<>点击「创建素材组」可创建虚拟人像组。首次创建需先在火山控制台签署授权函；真人素材需在控制台完成认证与授权。<a className="ml-1" href="https://www.volcengine.com/docs/82379/2333565" target="_blank" rel="noreferrer">查看创建指南</a></>} />}
                    <div className="text-xs opacity-60">项目名称留空使用 default；请选择与视频 API Key 所属项目一致的素材组。</div>
                    <div className="text-xs opacity-60">素材组与视频 API Key 须属于同一火山账号和项目。AK/SK 保存在当前浏览器，由前端签名并请求火山官方接口。</div>
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
                            <span className="min-w-0 flex-1 truncate text-sm" title={model.modelId ? `${model.name} · 请求 ID：${model.modelId}` : model.name}>{model.name}</span>
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

            <Modal title="创建素材组" open={Boolean(newArkGroup)} onCancel={() => { if (!arkGroupCreating) setNewArkGroup(null); }}
                onOk={() => void submitArkGroup()} okText="创建并选中" cancelText="取消" confirmLoading={arkGroupCreating}
                okButtonProps={{ disabled: !newArkGroup?.name.trim() }} cancelButtonProps={{ disabled: arkGroupCreating }}
                closable={!arkGroupCreating} keyboard={!arkGroupCreating} mask={{ closable: !arkGroupCreating }}>
                <div className="space-y-4 py-2">
                    <div className="text-sm">所属项目：{draft.arkAssets?.projectName.trim() || "default"}；类型：虚拟人像（AIGC）</div>
                    <label className="block"><span className="mb-1 block text-sm">素材组名称（必填）</span><Input aria-label="素材组名称" value={newArkGroup?.name || ""} disabled={arkGroupCreating} placeholder="名称上限为 64 字符" onChange={(event) => setNewArkGroup((current) => current && { ...current, name: event.target.value })} /></label>
                    <label className="block"><span className="mb-1 block text-sm">描述（可选）</span><Input.TextArea aria-label="素材组描述" value={newArkGroup?.description || ""} disabled={arkGroupCreating} placeholder="描述上限为 300 字符" onChange={(event) => setNewArkGroup((current) => current && { ...current, description: event.target.value })} /></label>
                    <div className="text-xs opacity-60">创建接口当前仅支持虚拟人像组。首次创建需先在火山控制台签署授权函；真人素材组请在控制台完成认证与授权。<a className="ml-1" href="https://www.volcengine.com/docs/82379/2333565" target="_blank" rel="noreferrer">查看指南</a></div>
                    {arkGroupCreateError && <Alert type="error" showIcon title="素材组创建失败" description={<>{arkGroupCreateError}<br />若请求中断或结果不明，请取消后刷新素材组确认结果，再决定是否重试。</>} />}
                </div>
            </Modal>

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
