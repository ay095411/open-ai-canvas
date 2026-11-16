import type { CreationInspiration } from "@/lib/inspirations/catalog";

/** 必需署名与许可始终可见，不能由首页来源开关隐藏。 */
export function InspirationAuthorizationNotice({ item }: { item: Pick<CreationInspiration, "authorization" | "credit" | "sourceId" | "sourceUrl" | "galleryUrl"> }) {
    if (item.sourceId === "zzai-gallery")
        return (
            <div className="inspiration-authorization-notice" aria-label="示例来源与授权提示" onClick={(event) => event.stopPropagation()}>
                <p>{item.credit ? `来源署名：${item.credit}` : "上游未标注作者"}</p>
                <p>
                    外部示例，授权未核验。
                    {item.sourceUrl ? (
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                            查看原始出处
                        </a>
                    ) : item.galleryUrl ? (
                        <a href={item.galleryUrl} target="_blank" rel="noreferrer">
                            查看上游页面
                        </a>
                    ) : null}
                </p>
            </div>
        );
    const authorization = item.authorization;
    if (!authorization || authorization.policyVersion !== "licensed-v1") return null;
    return (
        <div className="inspiration-authorization-notice" aria-label="素材署名与许可" onClick={(event) => event.stopPropagation()}>
            {item.credit ? <p>作者：{item.credit}</p> : null}
            {(
                [
                    ["提示词", authorization.promptLicense],
                    ["媒体", authorization.mediaLicense],
                ] as const
            ).map(([label, license]) => (
                <p key={label}>
                    {label}许可：
                    <a href={license.url} target="_blank" rel="noreferrer">
                        {license.name}
                    </a>
                    <span>
                        {" "}
                        · {license.attribution}
                        {license.rightsholder ? ` · 权利人：${license.rightsholder}` : ""}
                    </span>
                </p>
            ))}
        </div>
    );
}
