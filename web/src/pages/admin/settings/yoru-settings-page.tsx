import { App, Button, Input, InputNumber } from "antd";
import { Bot, BookOpen, RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ModelPicker } from "@/components/model-picker";
import { Select } from "@/components/ui/base/select";
import { systemChannelModelChannels } from "@/lib/user-session";
import { notifyYoruSettingsChanged } from "@/lib/yoru-events";
import { AdminPageFrame } from "@/pages/admin/components/admin-shell";
import { AdminStatusBadge, SettingsSectionCard } from "@/pages/admin/components/admin-ui";
import { Callout, Checkbox, Switch } from "@/pages/admin/ui/controls";
import { getAdminFeatureAvailability } from "@/services/api/auth";
import { getModelCatalog, listAdminLogicalModels, type AdminLogicalModel, type PublicChannelCatalog } from "@/services/api/logical-models";
import { getAdminYoru, saveAdminYoru, type AdminYoruSettings } from "@/services/api/yoru";
import { encodeChannelModel } from "@/stores/config-model-options";
import { defaultConfig } from "@/stores/use-config-store";
import type { FeatureAvailability } from "@/stores/use-user-store";

const navigation = ["创作影棚", "电商Agent", "灵感大厅", "自由画布", "Agent", "技能", "资产库", "创作历史", "积分中心"];
const errorText = (error: unknown) => (error instanceof Error ? error.message : "读取失败，请重试");

export default function YoruSettingsPage() {
    const { message } = App.useApp();
    const [setting, setSetting] = useState<AdminYoruSettings | null>(null);
    const [features, setFeatures] = useState<FeatureAvailability | null>(null);
    const [channels, setChannels] = useState<PublicChannelCatalog[] | null>(null);
    const [models, setModels] = useState<AdminLogicalModel[] | null>(null);
    const [loadError, setLoadError] = useState("");
    const [catalogError, setCatalogError] = useState("");
    const [routeError, setRouteError] = useState("");
    const [revision, setRevision] = useState(0);
    const [modelRevision, setModelRevision] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);

    useEffect(() => {
        const controller = new AbortController();
        setSetting(null);
        setFeatures(null);
        setLoadError("");
        void Promise.all([getAdminYoru(controller.signal), getAdminFeatureAvailability()])
            .then(([value, availability]) => {
                if (controller.signal.aborted) return;
                setSetting({ ...value, modelMode: value.modelMode || (value.logicalModelId ? "smart_route" : "direct") });
                setFeatures(availability.features);
                setDirty(false);
            })
            .catch((error) => {
                if (!controller.signal.aborted) setLoadError(errorText(error));
            });
        return () => controller.abort();
    }, [revision]);

    useEffect(() => {
        const controller = new AbortController();
        setChannels(null);
        setModels(null);
        setCatalogError("");
        setRouteError("");
        void getModelCatalog()
            .then((catalog) => {
                if (catalog.source !== "system" || !Array.isArray(catalog.channels)) throw new Error("模型目录响应无效");
                if (!controller.signal.aborted) setChannels(catalog.channels);
            })
            .catch((error) => {
                if (!controller.signal.aborted) setCatalogError(errorText(error));
            });
        void listAdminLogicalModels()
            .then((result) => {
                if (!controller.signal.aborted) setModels(result.models.filter((model) => model.capability === "text"));
            })
            .catch((error) => {
                if (!controller.signal.aborted) setRouteError(errorText(error));
            });
        return () => controller.abort();
    }, [revision, modelRevision]);

    const config = useMemo(() => (channels ? { ...defaultConfig, channels: systemChannelModelChannels(channels) } : null), [channels]);
    const directModels = useMemo(() => channels?.flatMap((channel) => channel.models.filter((model) => model.capability === "text").map((model) => ({ model, value: encodeChannelModel(channel.id, model.modelKey) }))) || [], [channels]);
    const selectedDirect = directModels.find((item) => item.model.id === setting?.channelModelId);
    const selectedRoute = models?.find((model) => model.id === setting?.logicalModelId);
    const modelReady = setting?.modelMode === "direct" ? Boolean(selectedDirect?.model.available) : Boolean(selectedRoute?.enabled && selectedRoute.available);
    const modelError = setting?.modelMode === "direct" ? catalogError : routeError;
    const modelLoading = !modelError && (setting?.modelMode === "direct" ? channels === null : models === null);
    const modelStatus = modelError ? "模型目录读取失败" : modelLoading ? "正在检查模型" : modelReady ? "文本模型已就绪" : "请配置可用文本模型";
    const active = setting?.enabled && features?.siteAssistantEnabled && features.creditsEnabled && modelReady;
    const change = <K extends keyof AdminYoruSettings>(key: K, value: AdminYoruSettings[K]) => {
        if (savingRef.current) return;
        setSetting((current) => (current ? { ...current, [key]: value } : current));
        setDirty(true);
    };

    async function save() {
        if (!setting || savingRef.current) return;
        if (setting.enabled && !modelReady) {
            message.error("启用小夜前，请选择一个可用文本模型");
            return;
        }
        const questions = setting.questions.map((value) => value.trim()).filter(Boolean);
        if (questions.length > 8 || questions.some((value) => [...value].length > 100)) {
            message.error("推荐问题最多 8 个，每个不超过 100 字");
            return;
        }
        savingRef.current = true;
        setSaving(true);
        try {
            setSetting(await saveAdminYoru({ ...setting, questions }));
            setDirty(false);
            notifyYoruSettingsChanged();
            message.success("小夜助手配置已保存");
        } catch (error) {
            message.error(errorText(error));
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    }

    return (
        <AdminPageFrame
            title="小夜助手"
            description="配置站内创作向导的开放范围、对话模型和引导内容。"
            scroll
            actions={
                <>
                    <Button
                        icon={<RefreshCw className="size-4" />}
                        disabled={saving || dirty}
                        onClick={() => {
                            if (!savingRef.current) setRevision((value) => value + 1);
                        }}
                    >
                        刷新配置
                    </Button>
                    <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={saving || !setting || !dirty || (setting.enabled && !modelReady)} onClick={() => void save()}>
                        保存设置
                    </Button>
                </>
            }
        >
            {!setting || !features ? (
                loadError ? (
                    <Callout tone="error" title="读取小夜配置失败">
                        {loadError}。请点击刷新配置重试。
                    </Callout>
                ) : (
                    <p role="status">正在读取小夜配置…</p>
                )
            ) : (
                <fieldset disabled={saving} className="m-0 grid min-w-0 gap-5 border-0 p-0 pb-8">
                    <SettingsSectionCard
                        icon={<Bot className="size-4" />}
                        title="开放与依赖"
                        description="小夜有独立的启用配置；功能开放和积分计费同时开启后，符合范围的用户才会看到助手。"
                        layout="stacked"
                        status={<AdminStatusBadge label={dirty ? "有未保存更改" : active ? "基础配置已就绪" : "尚未满足开放条件"} tone={!dirty && active ? "success" : "warning"} />}
                    >
                        <div className="grid gap-4 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <strong>启用小夜助手</strong>
                                    <p className="text-sm text-[var(--admin-text-muted)]">保存后生效。关闭会停止展示助手并禁止新对话。</p>
                                </div>
                                <Switch aria-label="启用小夜助手" checked={setting.enabled} disabled={saving || (!setting.enabled && !modelReady)} onChange={(value) => change("enabled", value)} />
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <AdminStatusBadge label={`功能开放：${features.siteAssistantEnabled ? "已开启" : "未开启"}`} tone={features.siteAssistantEnabled ? "success" : "warning"} />
                                <AdminStatusBadge label={`积分计费：${features.creditsEnabled ? "已开启" : "未开启"}`} tone={features.creditsEnabled ? "success" : "warning"} />
                                <AdminStatusBadge label={modelStatus} tone={modelReady ? "success" : "warning"} />
                            </div>
                            {!features.siteAssistantEnabled || !features.creditsEnabled ? (
                                <Callout tone="warning">
                                    小夜依赖功能开放中的「小夜助手」和「积分计费」开关。<Link to="/admin/settings/features">前往功能开放</Link> 完成设置。
                                </Callout>
                            ) : null}
                            <label className="grid gap-2">
                                开放范围
                                <Select
                                    aria-label="小夜开放范围"
                                    disabled={saving}
                                    value={setting.audience}
                                    options={[
                                        { value: "admin", label: "仅管理员验收" },
                                        { value: "all", label: "所有已登录用户" },
                                    ]}
                                    onChange={(value) => change("audience", value as AdminYoruSettings["audience"])}
                                />
                            </label>
                            <p className="text-sm text-[var(--admin-text-muted)]">游客不提供模型对话。助手在后台和画布详情页隐藏。</p>
                        </div>
                    </SettingsSectionCard>
                    <SettingsSectionCard
                        title="对话模型"
                        description="每轮对话使用当前用户的积分，沿用所选文本模型的价格与结算规则。"
                        layout="stacked"
                        status={
                            <Button
                                icon={<RefreshCw className="size-4" />}
                                disabled={saving}
                                onClick={() => {
                                    if (!savingRef.current) setModelRevision((value) => value + 1);
                                }}
                            >
                                刷新模型
                            </Button>
                        }
                    >
                        <div className="grid gap-4 p-4">
                            <label className="grid gap-2">
                                模型模式
                                <Select
                                    aria-label="小夜模型模式"
                                    disabled={saving}
                                    value={setting.modelMode}
                                    options={[
                                        { value: "direct", label: "固定文本渠道模型" },
                                        { value: "smart_route", label: "智能路由逻辑模型" },
                                    ]}
                                    onChange={(value) => change("modelMode", value as AdminYoruSettings["modelMode"])}
                                />
                            </label>
                            {modelError ? (
                                <Callout tone="error" title="模型目录读取失败">
                                    {modelError}。请刷新配置重试。
                                </Callout>
                            ) : null}
                            {setting.modelMode === "direct" ? (
                                config ? (
                                    <ModelPicker
                                        config={config}
                                        capability="text"
                                        value={selectedDirect?.value || ""}
                                        fullWidth
                                        showSelectedPrice={false}
                                        placeholder="选择小夜文本模型"
                                        modelDisabledReason={() => (savingRef.current ? "正在保存配置" : "")}
                                        onChange={(value) => {
                                            if (savingRef.current) return;
                                            const selected = directModels.find((item) => item.value === value);
                                            if (selected?.model.available) change("channelModelId", selected.model.id);
                                        }}
                                    />
                                ) : null
                            ) : (
                                <Select
                                    aria-label="小夜逻辑模型"
                                    disabled={saving}
                                    value={setting.logicalModelId || undefined}
                                    placeholder="选择已启用的文本逻辑模型"
                                    showSearch
                                    optionFilterProp="label"
                                    options={(models || []).map((model) => ({ value: model.id, label: `${model.name} · ${model.code}`, disabled: !model.enabled || !model.available }))}
                                    onChange={(value) => change("logicalModelId", String(value))}
                                />
                            )}
                            {!modelReady && !modelLoading && !modelError ? (
                                <Callout tone="warning">
                                    {(setting.modelMode === "direct" ? setting.channelModelId : setting.logicalModelId) ? "已保存的文本模型当前不可用，请重新选择；原有选择会保留到保存。" : "尚未选择文本模型。选择可用模型后才能启用小夜。"}{" "}
                                    <Link to={setting.modelMode === "direct" ? "/admin/channels" : "/admin/models"}>前往模型配置</Link>
                                </Callout>
                            ) : null}
                            <label className="grid gap-2">
                                单次回复最长 Token
                                <InputNumber
                                    aria-label="单次回复最长 Token"
                                    min={128}
                                    max={4096}
                                    value={setting.maxOutputTokens}
                                    onChange={(value) => {
                                        if (value !== null) change("maxOutputTokens", value);
                                    }}
                                />
                            </label>
                            <p className="text-sm text-[var(--admin-text-muted)]">小夜没有额外的每日次数或积分上限；余额不足时不创建收费任务。全员开放时，用户仍须具备所选模型的访问权限。</p>
                        </div>
                    </SettingsSectionCard>
                    <SettingsSectionCard title="角色与外观" description="用户可以拖动角色或隐藏助手，个人偏好优先于默认位置。" layout="stacked">
                        <div className="grid gap-4 p-4">
                            <label className="grid gap-2">
                                角色名称
                                <Input aria-label="小夜角色名称" value={setting.name} maxLength={40} onChange={(event) => change("name", event.target.value)} />
                            </label>
                            <label className="grid gap-2">
                                欢迎语
                                <Input.TextArea aria-label="小夜欢迎语" value={setting.welcome} rows={2} maxLength={500} onChange={(event) => change("welcome", event.target.value)} />
                            </label>
                            <div className="flex flex-wrap gap-4">
                                <label className="grid gap-2">
                                    角色高度（像素）
                                    <InputNumber
                                        aria-label="角色高度"
                                        min={100}
                                        max={240}
                                        value={setting.avatarSize}
                                        onChange={(value) => {
                                            if (value !== null) change("avatarSize", value);
                                        }}
                                    />
                                </label>
                                <label className="grid gap-2">
                                    距右侧（像素）
                                    <InputNumber
                                        aria-label="距右侧"
                                        min={0}
                                        max={200}
                                        value={setting.defaultRight}
                                        onChange={(value) => {
                                            if (value !== null) change("defaultRight", value);
                                        }}
                                    />
                                </label>
                                <label className="grid gap-2">
                                    距底部（像素）
                                    <InputNumber
                                        aria-label="距底部"
                                        min={0}
                                        max={200}
                                        value={setting.defaultBottom}
                                        onChange={(value) => {
                                            if (value !== null) change("defaultBottom", value);
                                        }}
                                    />
                                </label>
                            </div>
                            <div className="flex items-center gap-3">
                                <span>角色动作</span>
                                <Switch aria-label="小夜角色动作" checked={setting.motionEnabled} disabled={saving} onChange={(value) => change("motionEnabled", value)} />
                            </div>
                        </div>
                    </SettingsSectionCard>
                    <SettingsSectionCard icon={<BookOpen className="size-4" />} title="知识与引导" description="快捷导航仅提供已发布的站内入口。" layout="stacked">
                        <div className="grid gap-4 p-4">
                            <label className="grid gap-2">
                                系统说明
                                <Input.TextArea aria-label="小夜系统说明" value={setting.systemPrompt} rows={4} maxLength={8000} onChange={(event) => change("systemPrompt", event.target.value)} />
                            </label>
                            <label className="grid gap-2">
                                网站功能知识库
                                <Input.TextArea aria-label="小夜知识库" value={setting.knowledge} rows={6} maxLength={24000} onChange={(event) => change("knowledge", event.target.value)} />
                            </label>
                            <label className="grid gap-2">
                                推荐问题（每行一个，最多 8 个，每个 100 字）
                                <Input.TextArea aria-label="小夜推荐问题" value={setting.questions.join("\n")} rows={4} onChange={(event) => change("questions", event.target.value.split("\n"))} />
                            </label>
                            <div className="grid gap-2">
                                <span>快捷导航</span>
                                <div className="flex flex-wrap gap-3">
                                    {navigation.map((name) => (
                                        <Checkbox key={name} checked={setting.navigation.includes(name)} onChange={(event) => change("navigation", event.target.checked ? [...setting.navigation, name] : setting.navigation.filter((item) => item !== name))}>
                                            {name}
                                        </Checkbox>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </SettingsSectionCard>
                </fieldset>
            )}
        </AdminPageFrame>
    );
}
