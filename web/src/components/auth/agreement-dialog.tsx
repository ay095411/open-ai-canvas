import { Modal } from "antd";
import { FileText, LockKeyhole } from "lucide-react";

/**
 * 服务协议弹窗：登录表单（账号不存在 → 就地注册）与注册表单共用同一份。
 *
 * 协议标题与条款只能来自后台「登录与注册」配置；调用方只在拿到设置后展示入口，
 * 标题统一去掉书号后由界面补《》。
 */
export function AgreementDialog({ open, title, paragraphs, onClose }: { open: boolean; title: string; paragraphs: string[]; onClose: () => void }) {
    return (
        <Modal className="workspace-modal auth-agreement-modal" title={title} open={open} onCancel={onClose} footer={null} centered destroyOnHidden>
            {paragraphs.length === 0 ? (
                <div className="auth-agreement-empty">
                    <FileText className="size-3.5 shrink-0" aria-hidden />
                    服务协议内容待补充，请联系管理员在后台「登录与注册」中完善。
                </div>
            ) : (
                <div className="auth-agreement-body">
                    {paragraphs.map((paragraph, index) => {
                        // 后台用纯文本框维护条款，「一、二、三…」条目通常和正文写在同一个
                        // 段落里（只用一个换行分隔）。这里把条目标题切出来单独成行并加重，
                        // 否则标题和正文会挤在同一行，长条款失去可扫描的层级。
                        const blocks = splitAgreementParagraph(paragraph);
                        return blocks.map((block, blockIndex) => (
                            <p key={`agreement-${index}-${blockIndex}`} data-role={block.heading ? "heading" : undefined}>
                                {block.text}
                            </p>
                        ));
                    })}
                </div>
            )}
            <p className="auth-agreement-meta">
                <LockKeyhole className="size-3 shrink-0" aria-hidden />
                继续注册即表示你已阅读并接受本协议全部条款。
            </p>
        </Modal>
    );
}

/** 从设置里取出协议标题与段落；标题未配置时才回退到当前品牌名。 */
export function agreementFromSettings(settings: { agreementTitle?: string; agreementContent?: string } | null | undefined, brandName: string) {
    const title = ((settings?.agreementTitle || "").trim() || `${brandName}服务协议`).replace(/^《|》$/g, "");
    const content = (settings?.agreementContent || "").trim();
    return { title, paragraphs: content ? content.split(/\n\s*\n/) : [] };
}

// 中文条款里「一、」「二、」这类条目标题常与正文写在同一个段落内（只隔一个换行）。
// 这里按「条目标题 + 紧随其后的正文」拆成独立段落，让标题能单独成行并加重；
// 没有条目标题的普通段落原样返回，不改变后台已经整理好的排版。
const AGREEMENT_HEADING = /^\s*([一二三四五六七八九十百]+、[^\n]{0,40})\n+([\s\S]+)$/;

function splitAgreementParagraph(paragraph: string): { text: string; heading: boolean }[] {
    const match = paragraph.match(AGREEMENT_HEADING);
    if (!match) {
        const headingOnly = /^\s*[一二三四五六七八九十百]+、[^\n]{0,40}\s*$/.test(paragraph);
        return [{ text: paragraph.trim(), heading: headingOnly }];
    }
    return [
        { text: match[1].trim(), heading: true },
        { text: match[2].trim(), heading: false },
    ];
}
