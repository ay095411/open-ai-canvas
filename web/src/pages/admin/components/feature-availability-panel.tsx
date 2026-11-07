import type { ReactNode } from "react";
import { App, Button, Skeleton } from "antd";
import { AlertTriangle, CornerDownRight, RefreshCw, Video } from "lucide-react";
import { Link } from "react-router";
import { Switch } from "@/pages/admin/ui/controls";
import { cn } from "@/lib/utils";
import type { FeatureAvailability, FeatureAvailabilityKey } from "@/stores/use-user-store";
import { AdminStatusBadge } from "./admin-ui";
import { InspirationFeedRow } from "./inspiration-feed-row";
import { additionalTaskRows, featureByKey, featureGroups, featureRowState, missingFeatureRequirements, type FeatureRow } from "./feature-availability-catalog";
import { useFeatureAvailabilityEditor } from "./use-feature-availability-editor";
import "./feature-availability-panel.css";

export default function FeatureAvailabilityPanel() {
    const { message, modal } = App.useApp();
    const { features, loading, refreshing, savingKey, error, uncertain, load, save } = useFeatureAvailabilityEditor();

    const setFeature = async (key: FeatureAvailabilityKey, enabled: boolean) => {
        const result = await save(key, enabled);
        const title = featureByKey.get(key)?.title || "功能";
        if (result.kind === "saved") message.success(`${title}已${enabled ? "开启" : "关闭"}`);
        else if (result.kind === "recovered") message.success(`已重新核实，${title}当前为${enabled ? "开启" : "关闭"}`);
        else if (result.error) message.error(result.error);
    };

    const requestChange = (key: FeatureAvailabilityKey, enabled: boolean) => {
        if (!features || savingKey !== null || uncertain || features[key] === enabled) return;
        if (key === "creditsEnabled" && !enabled) {
            modal.confirm({
                title: "关闭用户积分功能？",
                content: "新创建的任务和系统渠道请求将不再扣减积分，小夜助手也将不可用；已经冻结的订单仍按原规则结算，已有余额和流水继续保留。",
                okText: "确认关闭",
                cancelText: "取消",
                okButtonProps: { danger: true },
                onOk: () => setFeature(key, false),
            });
        } else if (key === "frontendModelsEnabled" && !enabled) {
            modal.confirm({
                title: "关闭前台模型功能？",
                content: "关闭后用户将直接使用系统渠道中配置的模型。已有前台模型配置会保留，后台侧栏不再显示该入口，仍可从本页“配置前台模型”继续编辑。",
                okText: "确认关闭",
                cancelText: "取消",
                okButtonProps: { danger: true },
                onOk: () => setFeature(key, false),
            });
        } else void setFeature(key, enabled);
    };

    if (!features) {
        return (
            <div className="admin-settings-stack afp">
                {loading ? (
                    <div className="afp-group is-loading" role="status" aria-label="正在读取功能开放配置">
                        <Skeleton active paragraph={{ rows: 6 }} />
                    </div>
                ) : (
                    <div className="admin-feature-load-error" role="alert">
                        <AlertTriangle className="size-5" aria-hidden="true" />
                        <div>
                            <h2>无法读取功能开放配置</h2>
                            <p>{error}</p>
                        </div>
                        <Button icon={<RefreshCw className="size-4" />} onClick={() => void load()}>
                            重新读取
                        </Button>
                    </div>
                )}
            </div>
        );
    }

    const row = (item: FeatureRow) => <FeatureSettingRow key={item.key} row={item} features={features} savingKey={savingKey} uncertain={uncertain} onChange={requestChange} />;
    return (
        <div className="admin-settings-stack afp">
            <div className="admin-feature-command-bar">
                <div className="afp-command-copy" aria-live="polite">
                    <strong>{savingKey ? "正在保存更改" : "切换后自动保存"}</strong>
                    <AdminStatusBadge label={uncertain ? "保存结果待核实" : savingKey ? "提交中" : features.configured ? "服务端配置" : "系统默认"} tone={uncertain || savingKey ? "warning" : "neutral"} />
                </div>
                <Button icon={<RefreshCw className="size-4" />} loading={refreshing} disabled={savingKey !== null} onClick={() => void load()}>
                    刷新状态
                </Button>
            </div>
            {error ? (
                <div className="admin-feature-inline-alert" role="alert">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                </div>
            ) : null}
            <div className="afp-scope-note">创作影棚与电商Agent是独立入口。首页和自由画布的图片、视频生成不受下方影棚开关控制；开关关闭不删除历史作品。</div>
            {featureGroups.map((group) => (
                <FeatureGroup key={group.title} title={group.title} description={group.description} icon={<group.icon className="size-4" aria-hidden="true" />}>
                    {group.rows.map(row)}
                    {group.title === "页面辅助" ? <InspirationFeedRow /> : null}
                </FeatureGroup>
            ))}
            <details className="afp-group afp-legacy">
                <summary>
                    <Video className="size-4" aria-hidden="true" />
                    <strong>其他任务控制</strong>
                    <span>1 项 · 当前无独立前台流程</span>
                </summary>
                <p className="afp-scope-note">以下开关只控制电商项目视频任务，不影响创作影棚的视频工作台。</p>
                <div className="afp-list">{additionalTaskRows.map(row)}</div>
            </details>
        </div>
    );
}

function FeatureGroup({ title, description, icon, children }: { title: string; description: string; icon: ReactNode; children: ReactNode }) {
    return (
        <section className="afp-group">
            <header className="afp-group-header">
                <span className="afp-group-icon">{icon}</span>
                <div className="afp-group-copy">
                    <h2>{title}</h2>
                    <p>{description}</p>
                </div>
            </header>
            <div className="afp-list">{children}</div>
        </section>
    );
}

function FeatureSettingRow({
    row,
    features,
    savingKey,
    uncertain,
    onChange,
}: {
    row: FeatureRow;
    features: FeatureAvailability;
    savingKey: FeatureAvailabilityKey | null;
    uncertain: boolean;
    onChange: (key: FeatureAvailabilityKey, enabled: boolean) => void;
}) {
    const state = featureRowState(features, row);
    const missing = missingFeatureRequirements(features, row);
    const label = uncertain
        ? "待核实"
        : savingKey === row.key
          ? "保存中"
          : state === "blocked"
            ? features[row.key]
                ? "已开启 · 依赖未满足"
                : "已关闭 · 依赖未满足"
            : features[row.key]
              ? row.key === "siteAssistantEnabled"
                  ? "总开关已开"
                  : "已开启"
              : "已关闭";
    return (
        <article id={`admin-feature-${row.key}`} className={cn("afp-row", `is-${state}`, row.parent && "is-nested")}>
            <div className="afp-row-main">
                {row.parent ? <CornerDownRight className="afp-row-branch size-4" aria-hidden="true" /> : null}
                <span className="afp-row-icon">
                    <row.icon className="size-4" aria-hidden="true" />
                </span>
                <div className="afp-row-copy">
                    <div className="afp-row-title">
                        <strong>{row.title}</strong>
                        <span className="afp-location">{row.location}</span>
                    </div>
                    <p id={`admin-feature-description-${row.key}`}>
                        {row.description}
                        {row.link ? (
                            <Link className="afp-link" to={row.link.to}>
                                {row.link.label}
                            </Link>
                        ) : null}
                    </p>
                    {missing.length ? (
                        <p className="afp-row-warning">
                            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                            <span>
                                需先开启
                                {missing.map((key) => (
                                    <button key={key} type="button" className="afp-dep-link" onClick={() => document.getElementById(`admin-feature-${key}`)?.scrollIntoView({ block: "center" })}>
                                        {featureByKey.get(key)?.title || key}
                                    </button>
                                ))}
                                ，当前保留本开关的保存值。
                            </span>
                        </p>
                    ) : null}
                </div>
            </div>
            <div className="afp-row-control">
                {row.key === "frontendModelsEnabled" ? (
                    <div className="afp-source" role="group" aria-label="选择用户模型目录来源">
                        <button type="button" aria-pressed={!features.frontendModelsEnabled} disabled={savingKey !== null || uncertain} className={cn(!features.frontendModelsEnabled && "is-selected")} onClick={() => onChange(row.key, false)}>
                            系统渠道
                        </button>
                        <button type="button" aria-pressed={features.frontendModelsEnabled} disabled={savingKey !== null || uncertain} className={cn(features.frontendModelsEnabled && "is-selected")} onClick={() => onChange(row.key, true)}>
                            前台目录
                        </button>
                    </div>
                ) : (
                    <>
                        <AdminStatusBadge label={label} tone={state === "blocked" || uncertain ? "warning" : state === "on" ? "success" : "neutral"} />
                        <Switch
                            checked={features[row.key]}
                            loading={savingKey === row.key}
                            disabled={savingKey !== null || uncertain || state === "blocked"}
                            onChange={(checked) => onChange(row.key, checked)}
                            aria-describedby={`admin-feature-description-${row.key}`}
                            aria-label={`设置${row.title}，切换后自动保存`}
                        />
                    </>
                )}
            </div>
        </article>
    );
}
