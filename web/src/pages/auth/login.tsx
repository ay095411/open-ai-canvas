import { type FormEvent, useEffect, useState } from "react";
import { App, Button, Input, Segmented } from "antd";
import { LockKeyhole, UserRound } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { getAuthSession, getAuthSettings, linuxDOLoginURL, login } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";
import { LinuxDOIcon } from "./auth-scene";
import { VerificationFields } from "@/components/auth/verification-fields";
import { emptyVerification, loginVerification, methodLabels, verificationMethods, type VerificationMethod } from "@/services/api/verification";

export default function LoginPage() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { message } = App.useApp();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [linuxdoEnabled, setLinuxdoEnabled] = useState(false);
    const [methods, setMethods] = useState<VerificationMethod[]>([]);
    const [method, setMethod] = useState<"password" | VerificationMethod>("password");
    const [verification, setVerification] = useState({ ...emptyVerification });
    const next = safeNext(params.get("next"));
    const forgotPasswordURL = `/forgot-password?next=${encodeURIComponent(next)}`;
    const user = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);

    // 如果已登录，直接跳转
    useEffect(() => {
        if (hydrated && user) {
            navigate(next, { replace: true });
        }
    }, [hydrated, user, next, navigate]);

    useEffect(() => {
        void getAuthSettings()
            .then((settings) => { setLinuxdoEnabled(settings.linuxdoEnabled); setMethods(verificationMethods(settings, "login")); })
            .catch((error) => {
                // 这是登录页的展示配置读取：失败时明确隐藏第三方入口，
                // 账号密码登录仍可用；不能无痕地把配置读取失败当成成功。
                console.warn("读取登录方式配置失败，已隐藏第三方登录入口", error);
            });
        const oauthError = params.get("oauth_error");
        if (oauthError) message.error(oauthError);
    }, [message, params]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSubmitting(true);
        try {
            if (method === "password") await login({ username, password });
            else {
                if (!verification.ticket) throw new Error("请先获取本次登录验证码");
                await loginVerification(verification);
            }
            const { applyUserSession } = await import("@/lib/user-session");
            await applyUserSession(await getAuthSession());
            message.success("登录成功");
            navigate(next, { replace: true });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "登录失败");
        } finally {
            setSubmitting(false);
        }
    };

    /**
     * 字段不再单独配一行 label：占位符 + 前缀图标已经说清了每个框是什么，
     * 「用户名 / 邮箱」「密码」两行小字是纯重复。可访问性靠 aria-label 兜住
     * （视觉隐藏的 label 不如 aria-label 可靠，antd Input 会把 aria-label 透传到 input）。
     * 「忘记密码？」放在密码框与提交按钮之间、右对齐：一是紧跟它要补救的那个字段，
     * 二是让卡片以主按钮收尾——挂在按钮下面时，整卡最后一行是一条 12px 的小字，
     * 尾部看上去像没收住。
     */
    return (
        <form onSubmit={submit} className="flex flex-col gap-4">
            {methods.length > 0 && <Segmented block aria-label="登录方式" value={method} disabled={submitting} options={[{ value: "password", label: "密码登录" }, ...methods.map((value) => ({ value, label: methodLabels[value] }))]} onChange={(value) => { setMethod(value as typeof method); setVerification({ ...emptyVerification }); }} />}
            {method !== "password" ? <VerificationFields key={method} purpose="login" method={method} value={verification} onChange={setVerification} disabled={submitting} /> : <>
                <Input id="login-account" aria-label="用户名或邮箱" size="large" prefix={<UserRound className="auth-scene-icon size-4" />} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名或邮箱" autoComplete="username" required />
                <Input.Password id="login-password" aria-label="密码" size="large" prefix={<LockKeyhole className="auth-scene-icon size-4" />} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码" autoComplete="current-password" required />
            </>}
            <div className="-my-1 flex justify-end">
                <Link to={forgotPasswordURL} className="auth-scene-link inline-flex min-h-6 items-center rounded-sm text-xs font-medium transition-colors">
                    忘记密码？
                </Link>
            </div>
            <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
                登录
            </Button>
            {/* 第三方登录不再配「或」分隔线：整页只有两个区块时，一条分割线带来的
                视觉噪音大于它的分组作用，改用按钮间距区分。 */}
            {linuxdoEnabled ? (
                <Button size="large" block icon={<LinuxDOIcon />} href={linuxDOLoginURL(next)}>
                    使用 Linux.do 登录
                </Button>
            ) : null}
        </form>
    );
}

function safeNext(value: string | null) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
    return value;
}
