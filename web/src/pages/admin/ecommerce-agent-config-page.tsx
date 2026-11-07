import { Button } from "antd";
import { ArrowUpRight, Layers3, ListChecks, RefreshCw, ShoppingBag } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { getAdminFeatureAvailability } from "@/services/api/auth";
import { getCommerceAgentSetting, type CommerceAgentSetting } from "@/services/api/ecommerce-knowledge";
import type { FeatureAvailability } from "@/stores/use-user-store";
import { AdminPageFrame } from "./components/admin-shell";
import { AdminStatusBadge, SettingsSectionCard } from "./components/admin-ui";
import { EcommerceStageModels } from "./ecommerce-stage-models";
import "./ecommerce-agent-config.css";

type ReadinessRow = { key: string; title: string; description: string; icon: ReactNode; ready: boolean; action: { label: string; run: () => void } };

const stageModelsAnchor = "eac-stage-models";
const hasModel = (ref?: { logicalModelId?: string; channelModelId?: string }) => Boolean(ref?.logicalModelId || ref?.channelModelId);

/**
 * 电商Agent配置：汇总功能开放状态与阶段模型，并链接到各自的配置入口。
 */
export default function EcommerceAgentConfigPage() {
    const navigate = useNavigate();
    const [features, setFeatures] = useState<FeatureAvailability | null>(null);
    const [agentSetting, setAgentSetting] = useState<CommerceAgentSetting | null>(null);
    const [loadError, setLoadError] = useState("");
    const [loading, setLoading] = useState(false);
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [availability, setting] = await Promise.all([getAdminFeatureAvailability(), getCommerceAgentSetting()]);
            setFeatures(availability.features);
            setAgentSetting(setting);
            setLoadError("");
        } catch (cause) {
            setFeatures(null);
            setAgentSetting(null);
            setLoadError(cause instanceof Error ? cause.message : "读取上线状态失败");
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        void load();
    }, [load]);
    const openFeatures = () => navigate("/admin/settings/features");
    const openStageModels = () => document.getElementById(stageModelsAnchor)?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    // 运行时实际生效的模型：识别阶段缺省时沿用策划模型。
    const planningReady = hasModel(agentSetting ?? undefined);
    const visionReady = hasModel(agentSetting?.vision) || planningReady;
    const rows: ReadinessRow[] = features
        ? [
              {
                  key: "ecommerce",
                  title: "电商Agent",
                  description: "统一控制商品识别、策划、出图与重试，不依赖创作影棚开关。",
                  icon: <ShoppingBag className="size-4" aria-hidden="true" />,
                  ready: features.ecommerceEnabled,
                  action: { label: "去功能开放", run: openFeatures },
              },
              {
                  key: "models",
                  title: "阶段模型已配置",
                  description: visionReady && planningReady ? "识别与策划模型已指定，提交时校验可用性。" : "请配置商品识别与整套策划模型。",
                  icon: <Layers3 className="size-4" aria-hidden="true" />,
                  ready: visionReady && planningReady,
                  action: { label: "去配置", run: openStageModels },
              },
          ]
        : [];
    const missing = rows.filter((row) => !row.ready).length;

    return (
        <AdminPageFrame title="电商Agent配置" description="设置识别与策划模型，检查电商功能开放状态。" scroll>
            <div className="admin-settings-stack eac-page">
                <SettingsSectionCard
                    className="eac-section"
                    layout="stacked"
                    icon={<ListChecks className="size-4" aria-hidden="true" />}
                    title="上线检查"
                    description="检查功能开关与阶段模型；模型可用性和费用在提交时校验。"
                    status={loadError ? <AdminStatusBadge label="读取失败" tone="warning" /> : features ? <AdminStatusBadge label={missing ? `还差 ${missing} 项` : "配置已齐备"} tone={missing ? "warning" : "success"} /> : undefined}
                    footer={
                        <>
                            <span className="eac-save-state">{loadError ? `读取失败：${loadError}` : features ? "以服务端当前配置为准" : "正在读取…"}</span>
                            <div className="eac-save-actions">
                                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                                    刷新
                                </Button>
                            </div>
                        </>
                    }
                >
                    <ul className="eac-availability">
                        {rows.map((row) => (
                            <li key={row.key}>
                                <span className="eac-availability-icon">{row.icon}</span>
                                <div>
                                    <strong>{row.title}</strong>
                                    <span>{row.description}</span>
                                </div>
                                <div className="eac-readiness-actions">
                                    <AdminStatusBadge label={row.ready ? "已就绪" : "未完成"} tone={row.ready ? "success" : "warning"} />
                                    {row.ready ? null : (
                                        <Button size="small" icon={<ArrowUpRight className="size-3.5" />} iconPlacement="end" onClick={row.action.run}>
                                            {row.action.label}
                                        </Button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                </SettingsSectionCard>

                <div id={stageModelsAnchor}>
                    <SettingsSectionCard className="eac-section" layout="stacked" icon={<Layers3 className="size-4" aria-hidden="true" />} title="阶段模型" description="识别与策划模型由管理员配置，所有用户共用。">
                        <EcommerceStageModels embedded onSaved={() => void load()} />
                    </SettingsSectionCard>
                </div>
            </div>
        </AdminPageFrame>
    );
}
