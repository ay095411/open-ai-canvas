import { type FormEvent, useEffect, useState } from "react";
import { App, Button, Input, Segmented } from "antd";
import { LockKeyhole, UserRound } from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { getAuthSession, getAuthSettings, linuxDOLoginURL, login } from "@/services/api/auth";
import { LinuxDOIcon } from "@/components/auth/linuxdo-icon";
import { VerificationFields } from "@/components/auth/verification-fields";
import { emptyVerification, loginVerification, methodLabels, verificationMethods, type VerificationMethod } from "@/services/api/verification";
import { interceptAuthLink } from "@/lib/workspace-auth";

/**
 * 登录表单本体。
 *
 * 原先它是 `/login` 独立页（`pages/auth/login.tsx`）的全部内容，页面自己 `navigate(next)`
 * 决定去向；现在由工作台的登录弹窗承载，所以这里**不再碰路由**：
 * - 成功后只回调 `onSuccess()`，去哪儿由宿主按 `next` / 来源页决定；
 * - 「忘记密码？」要离开弹窗，找回密码仍是独立页，所以点它时先 `onClose()`；
 * - 「已登录就别再看这张表单」的兜底也上移到宿主（那是弹窗的开关语义，不是表单的）。
 */
export function LoginForm({ next, onSuccess }: { next: string; onSuccess: () => void }) {
    const [params] = useSearchParams();
    const { message } = App.useApp();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [linuxdoEnabled, setLinuxdoEnabled] = useState(false);
    const [methods, setMethods] = useState<VerificationMethod[]>([]);
    const [method, setMethod] = useState<"password" | VerificationMethod>("password");
    const [verification, setVerification] = useState({ ...emptyVerification });
    const forgotPasswordURL = `/forgot-password?next=${encodeURIComponent(next)}`;

    useEffect(() => {
        void getAuthSettings()
            .then((settings) => {
                setLinuxdoEnabled(settings.linuxdoEnabled);
                setMethods(verificationMethods(settings, "login"));
            })
            .catch((error) => {
                // 这是登录方式的展示配置读取：失败时明确隐藏第三方入口，
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
            onSuccess();
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
     * 二是让表单以主按钮收尾——挂在按钮下面时，最后一行是一条 12px 的小字，
     * 尾部看上去像没收住。
     */
    return (
        <form onSubmit={submit} className="flex flex-col gap-4">
            {methods.length > 0 && <Segmented block aria-label="登录方式" value={method} disabled={submitting} options={[{ value: "password", label: "密码登录" }, ...methods.map((value) => ({ value, label: methodLabels[value] }))]} onChange={(value) => { setMethod(value as typeof method); setVerification({ ...emptyVerification }); }} className="bg-white/5 border border-white/5" />}
            {method !== "password" ? <VerificationFields key={method} purpose="login" method={method} value={verification} onChange={setVerification} disabled={submitting} /> : <>
                <Input id="login-account" aria-label="用户名或邮箱" size="large" prefix={<UserRound className="auth-scene-icon size-4 text-white/40" />} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名或邮箱" autoComplete="username" required className="h-12 rounded-2xl bg-white/5 border-white/10 hover:border-white/20 focus:border-white/30 text-white placeholder:text-white/30" />
                <Input.Password id="login-password" aria-label="密码" size="large" prefix={<LockKeyhole className="auth-scene-icon size-4 text-white/40" />} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码" autoComplete="current-password" required className="h-12 rounded-2xl bg-white/5 border-white/10 hover:border-white/20 focus:border-white/30 text-white placeholder:text-white/30" />
            </>}
            <div className="-my-1 flex justify-end">
                {/* 就地切到找回密码表单：`/forgot-password` 是空壳路由，真跳过去会卸载
                    整棵页面树再被宿主换回来（空白几帧）。href 保留给中键 / 新标签页。 */}
                <Link to={forgotPasswordURL} onClick={(event) => interceptAuthLink(event, { mode: "recovery", next })} className="auth-scene-link inline-flex min-h-6 items-center rounded-sm text-xs font-medium transition-colors text-white/50 hover:text-white/90">
                    忘记密码？
                </Link>
            </div>
            <Button type="primary" htmlType="submit" size="large" block loading={submitting} className="h-12 rounded-2xl bg-white text-black hover:bg-white/90 font-medium text-[15px] border-0 mt-2">
                登录并进入创作
            </Button>
            {/* 第三方登录不再配「或」分隔线：只有两个区块时，一条分割线带来的
                视觉噪音大于它的分组作用，改用按钮间距区分。 */}
            {linuxdoEnabled ? (
                <Button size="large" block icon={<LinuxDOIcon />} href={linuxDOLoginURL(next)} className="h-12 rounded-2xl bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-white/20 hover:text-white">
                    使用 Linux.do 登录
                </Button>
            ) : null}
        </form>
    );
}
