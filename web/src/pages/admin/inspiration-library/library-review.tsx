import { Alert, Button, Form, Input } from "antd";
import { useState } from "react";

import { adminInspirationLibraryMediaUrl, type InspirationLibraryLicense, type InspirationLibraryRecord, type LibraryCandidate } from "@/services/api/inspiration-library-admin";
import { AdminCheckbox } from "../ui/controls";
import { AdminStatusBadge } from "../components/admin-ui";
import { candidateOf, libraryApprovalIssues } from "./candidate-import";

const licenseFields = [
    { key: "rightsholder", label: "权利人" },
    { key: "name", label: "许可名称" },
    { key: "url", label: "许可/证据地址" },
    { key: "attribution", label: "必要署名" },
    { key: "evidence", label: "授权证据正文" },
] as const;

function LicenseFields({ label, license, disabled, onChange }: { label: string; license: InspirationLibraryLicense; disabled: boolean; onChange: (license: InspirationLibraryLicense) => void }) {
    return (
        <fieldset className="inspiration-review-section" disabled={disabled}>
            <legend>{label}授权</legend>
            {licenseFields.map(({ key, label: fieldLabel }) => (
                <Form.Item key={key} label={fieldLabel}>
                    {key === "evidence" || key === "attribution" ? (
                        <Input.TextArea aria-label={`${label}${fieldLabel}`} value={license[key]} onChange={(event) => onChange({ ...license, [key]: event.target.value })} rows={key === "evidence" ? 4 : 2} />
                    ) : (
                        <Input aria-label={`${label}${fieldLabel}`} value={license[key]} onChange={(event) => onChange({ ...license, [key]: event.target.value })} />
                    )}
                </Form.Item>
            ))}
            <div className="inspiration-review-checks">
                <AdminCheckbox checked={license.commercialUse} disabled={disabled} onChange={(event) => onChange({ ...license, commercialUse: event.target.checked })}>
                    明确允许商用展示
                </AdminCheckbox>
                <AdminCheckbox checked={license.redistribution} disabled={disabled} onChange={(event) => onChange({ ...license, redistribution: event.target.checked })}>
                    明确允许转载/再分发
                </AdminCheckbox>
            </div>
        </fieldset>
    );
}

export function LibraryReview({
    record,
    working,
    error,
    notice,
    onSave,
    onReview,
    onReload,
}: {
    record: InspirationLibraryRecord;
    working: boolean;
    error: string;
    notice: string;
    onSave: (candidate: LibraryCandidate) => Promise<void>;
    onReview: (action: "approve" | "reject", reason: string) => Promise<void>;
    onReload: () => void;
}) {
    const baseline = candidateOf(record);
    const [draft, setDraft] = useState(baseline);
    const [preview, setPreview] = useState(false);
    const [previewError, setPreviewError] = useState("");
    const [reason, setReason] = useState("");
    const [confirmed, setConfirmed] = useState([false, false, false]);
    const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
    const issues = libraryApprovalIssues(draft);
    const imageUrl = adminInspirationLibraryMediaUrl(record, "image");
    const videoUrl = record.mode === "video" ? adminInspirationLibraryMediaUrl(record, "video") : undefined;
    const previewUrl = record.mode === "video" ? videoUrl : imageUrl;
    const approveBlocked = working || dirty || record.status !== "pending" || !previewUrl || !reason.trim() || issues.length > 0 || !confirmed.every(Boolean);

    return (
        <div className="inspiration-review">
            <div className="inspiration-review-heading">
                <h2>{record.title}</h2>
                <AdminStatusBadge
                    label={`版本 ${record.revision} · ${record.status === "approved" ? "已批准" : record.status === "rejected" ? "已拒绝" : "待审核"}`}
                    tone={record.status === "approved" ? "success" : record.status === "rejected" ? "error" : "warning"}
                />
            </div>
            <p className="inspiration-library-note">模型名、投稿作者和来源地址不是许可证明。提示词与展示媒体必须分别核实；批准只针对当前内容与固定媒体版本。</p>
            <dl className="inspiration-review-metadata">
                <dt>标识</dt>
                <dd>{record.slug}</dd>
                <dt>模型标注</dt>
                <dd>{record.model || "未标注"}</dd>
                <dt>作者/来源</dt>
                <dd>
                    {record.author || "未填作者"}
                    <br />
                    {record.sourceUrl || "未填来源"}
                </dd>
                <dt>固定资源</dt>
                <dd>
                    {record.image}
                    {record.videoUrl ? (
                        <>
                            <br />
                            {record.videoUrl}
                        </>
                    ) : null}
                </dd>
                <dt>内容哈希</dt>
                <dd>{record.contentHash}</dd>
                <dt>媒体哈希</dt>
                <dd>
                    {record.imageHash}
                    {record.videoHash ? (
                        <>
                            <br />
                            {record.videoHash}
                        </>
                    ) : null}
                </dd>
            </dl>
            {record.description ? <p className="inspiration-review-description">{record.description}</p> : null}
            <section className="inspiration-review-section">
                <h3>提示词正文</h3>
                <pre>{record.prompt}</pre>
                {record.promptZh ? (
                    <>
                        <h3>中文版本</h3>
                        <pre>{record.promptZh}</pre>
                    </>
                ) : null}
            </section>
            <section className="inspiration-review-section">
                <h3>固定版本媒体审查</h3>
                <p className="inspiration-library-note">默认不加载图片或视频。主动预览仅访问本站管理员媒体端点，不抓取外站；后端核对资源 SHA256 和版本。</p>
                <Button
                    disabled={working || !previewUrl}
                    onClick={() => {
                        setPreview(!preview);
                        setPreviewError("");
                    }}
                >
                    {preview ? "关闭媒体预览" : "主动预览当前媒体"}
                </Button>
                {!previewUrl ? <Alert type="error" title="缺少有效的固定媒体版本，请重新读取或重新导入" /> : null}
                {preview && previewUrl ? (
                    <div className="inspiration-review-preview">
                        {record.mode === "video" ? (
                            <video key={previewUrl} src={previewUrl} controls preload="metadata" onError={() => setPreviewError("固定版本视频无法读取，请核对资源和版本后重试")} />
                        ) : (
                            <img src={previewUrl} alt={record.title} referrerPolicy="no-referrer" onError={() => setPreviewError("固定版本图片无法读取，请核对资源和版本后重试")} />
                        )}
                    </div>
                ) : null}
                {previewError ? <Alert type="error" title={previewError} /> : null}
            </section>
            <Form layout="vertical" className="inspiration-review-form">
                <LicenseFields label="提示词" license={draft.promptLicense} disabled={working} onChange={(promptLicense) => setDraft({ ...draft, promptLicense })} />
                <LicenseFields label="展示媒体" license={draft.mediaLicense} disabled={working} onChange={(mediaLicense) => setDraft({ ...draft, mediaLicense })} />
                <fieldset className="inspiration-review-section" disabled={working}>
                    <legend>媒体与竞争关联</legend>
                    <div className="inspiration-review-checks">
                        <AdminCheckbox checked={draft.mediaReviewed} disabled={working} onChange={(event) => setDraft({ ...draft, mediaReviewed: event.target.checked })}>
                            已人工审查当前媒体内容、人物/商标/水印与所需权利
                        </AdminCheckbox>
                        <AdminCheckbox checked={draft.competitorAssociation === true} disabled={working} onChange={(event) => setDraft({ ...draft, competitorAssociation: event.target.checked })}>
                            存在竞争平台、模型、作者或水印关联
                        </AdminCheckbox>
                        <AdminCheckbox checked={draft.competitorException} disabled={working} onChange={(event) => setDraft({ ...draft, competitorException: event.target.checked })}>
                            已取得该竞争关联素材的明确例外授权
                        </AdminCheckbox>
                    </div>
                    <Form.Item label="竞争关联/例外证据">
                        <Input.TextArea aria-label="竞争关联/例外证据" value={draft.competitorEvidence || ""} rows={3} onChange={(event) => setDraft({ ...draft, competitorEvidence: event.target.value })} />
                    </Form.Item>
                </fieldset>
            </Form>
            <p className="inspiration-library-note">保存候选证据不是批准：内容/授权变化会产生新版本并回到待审核，已批准素材立即退出白名单；相同内容不会重置批准状态。请先保存，再核对新版本批准。</p>
            <Button disabled={working || !dirty} loading={working} onClick={() => void onSave(draft)}>
                保存候选证据
            </Button>
            <section className="inspiration-review-section">
                <h3>逐条授权审核</h3>
                {record.reviewReason ? <p>上次审核原因：{record.reviewReason}</p> : null}
                {issues.length ? (
                    <Alert
                        type="warning"
                        title="当前尚不能批准"
                        description={
                            <ul>
                                {issues.map((issue) => (
                                    <li key={issue}>{issue}</li>
                                ))}
                            </ul>
                        }
                    />
                ) : null}
                {dirty ? <Alert type="warning" title="有未保存的授权证据，批准操作已禁用" /> : null}
                <div className="inspiration-review-checks">
                    {["确认提示词授权覆盖本站商用展示与转载/再分发", "确认展示媒体授权覆盖本站商用展示与转载/再分发", "已核对当前固定媒体版本与必要署名"].map((label, index) => (
                        <AdminCheckbox key={label} checked={confirmed[index]} disabled={working} onChange={(event) => setConfirmed(confirmed.map((value, i) => (i === index ? event.target.checked : value)))}>
                            {label}
                        </AdminCheckbox>
                    ))}
                </div>
                <Form.Item label="审核/拒绝/下架原因">
                    <Input.TextArea aria-label="审核/拒绝/下架原因" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} disabled={working} placeholder="批准、拒绝或下架均必须填写具体核实结论或原因" />
                </Form.Item>
                <div className="inspiration-review-actions">
                    <Button type="primary" disabled={approveBlocked} loading={working} onClick={() => void onReview("approve", reason.trim())}>
                        批准当前版本
                    </Button>
                    <Button danger disabled={working || dirty || !reason.trim() || record.status === "rejected"} onClick={() => void onReview("reject", reason.trim())}>
                        {record.status === "approved" ? "下架当前版本" : "拒绝当前版本"}
                    </Button>
                    <Button disabled={working} onClick={onReload}>
                        重新读取当前版本
                    </Button>
                </div>
            </section>
            {error ? <Alert type="error" title={error} description="操作未确认成功；若版本冲突，请重新读取并重新核对，勿重复提交旧版本。" /> : null}
            {notice ? <Alert type="success" title={notice} /> : null}
        </div>
    );
}
