import { useEffect, useState, type FormEvent } from "react";
import { App, Button, Input } from "antd";
import { ArrowRight, LockKeyhole, Sparkles, UserRound, Video, Wand2 } from "lucide-react";
import { Link } from "react-router";

import { AppModal } from "@/components/ui/product/app-modal";
import { getAuthSession, login } from "@/services/api/auth";

/**
 * PixTV 风格双栏画廊式登录弹窗
 * 左侧：影视级轮播展映 + 激励文案
 * 右侧：大胶囊免密输入 + 创作者激励引导
 */
export function CreationLoginDialogPixTV({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { message } = App.useApp();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) {
            setUsername("");
            setPassword("");
            setSubmitting(false);
        }
    }, [open]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        try {
            await login({ username: username.trim(), password });
            const { applyUserSession } = await import("@/lib/user-session");
            await applyUserSession(await getAuthSession());
            message.success("登录成功！新用户创作积分已到账");
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "登录失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AppModal
            open={open}
            onCancel={onClose}
            title={null}
            footer={null}
            centered
            width="min(960px, calc(100vw - 48px))"
            className="pixtv-login-dialog"
            styles={{ body: { padding: 0 }, header: { display: "none" } }}
            closeIcon={null}
        >
            <div className="pixtv-login-container">
                {/* 左侧：影视画廊与激励文案 */}
                <div className="pixtv-login-promo">
                    <div className="pixtv-login-promo-bg" />
                    <div className="pixtv-login-promo-content">
                        <div className="pixtv-login-promo-icons">
                            <div className="pixtv-promo-icon">
                                <Video className="size-6" strokeWidth={1.5} />
                            </div>
                            <div className="pixtv-promo-icon">
                                <Wand2 className="size-6" strokeWidth={1.5} />
                            </div>
                            <div className="pixtv-promo-icon">
                                <Sparkles className="size-6" strokeWidth={1.5} />
                            </div>
                        </div>
                        <h2 className="pixtv-promo-title">让灵感，在这里成为作品</h2>
                        <p className="pixtv-promo-subtitle">
                            AI 一键分镜 · 超长视频生成 · 专业影视创作
                        </p>
                        <ul className="pixtv-promo-features">
                            <li>新用户创作积分已到账</li>
                            <li>无限画布，随心编排</li>
                            <li>多模型协作，高效创作</li>
                        </ul>
                    </div>
                </div>

                {/* 右侧：胶囊化登录表单 */}
                <div className="pixtv-login-form-wrapper">
                    <button
                        type="button"
                        onClick={onClose}
                        className="pixtv-login-close"
                        aria-label="关闭"
                    >
                        ×
                    </button>
                    <div className="pixtv-login-form-content">
                        <div className="pixtv-login-header">
                            <h3>登录并开始创作</h3>
                            <p>你的创作内容会保留。登录成功后，请再次点击生成。</p>
                        </div>

                        <form className="pixtv-login-form" onSubmit={(event) => void submit(event)}>
                            <div className="pixtv-input-group">
                                <div className="pixtv-input-wrapper">
                                    <UserRound className="pixtv-input-icon" />
                                    <Input
                                        size="large"
                                        aria-label="用户名或邮箱"
                                        value={username}
                                        onChange={(event) => setUsername(event.target.value)}
                                        placeholder="用户名或邮箱"
                                        autoComplete="username"
                                        required
                                        bordered={false}
                                        className="pixtv-input"
                                    />
                                </div>
                            </div>

                            <div className="pixtv-input-group">
                                <div className="pixtv-input-wrapper">
                                    <LockKeyhole className="pixtv-input-icon" />
                                    <Input.Password
                                        size="large"
                                        aria-label="密码"
                                        value={password}
                                        onChange={(event) => setPassword(event.target.value)}
                                        placeholder="密码"
                                        autoComplete="current-password"
                                        required
                                        bordered={false}
                                        className="pixtv-input"
                                    />
                                </div>
                            </div>

                            <Button
                                type="primary"
                                htmlType="submit"
                                size="large"
                                block
                                loading={submitting}
                                icon={<ArrowRight className="size-4" />}
                                iconPlacement="end"
                                className="pixtv-submit-btn"
                            >
                                登录并继续创作
                            </Button>
                        </form>

                        <div className="pixtv-login-footer">
                            <span>还没有账号？</span>
                            <Link to="/register?next=%2F" onClick={onClose} className="pixtv-link">
                                立即注册
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </AppModal>
    );
}
