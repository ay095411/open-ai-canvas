import { type FormEvent, useEffect, useState } from "react";
import { App, Button, Checkbox, Input, Segmented } from "antd";
import { ArrowLeftRight, Info, LockKeyhole, Mail, TriangleAlert, UserRound, UserRoundPlus } from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { getAuthSession, getAuthSettings, linuxDOLoginURL, login, register, type AuthSettings } from "@/services/api/auth";
import { AgreementDialog, agreementFromSettings } from "@/components/auth/agreement-dialog";
import { LinuxDOIcon } from "@/components/auth/linuxdo-icon";
import { VerificationFields } from "@/components/auth/verification-fields";
import { ApiError } from "@/services/api/request";
import { clearReferralCode, readReferralCode } from "@/lib/auth-entry";
import { emptyVerification, loginVerification, methodLabels, registrationVerificationRequired, verificationMethods, type VerificationMethod } from "@/services/api/verification";
import { interceptAuthLink } from "@/lib/workspace-auth";
import { useAppearanceStore } from "@/stores/use-appearance-store";

/** 服务端确认账号不存在后进入的补充注册步骤；accountKind 决定账号按用户名还是邮箱创建。 */
type PendingRegistration = { accountKind: "username" | "email" };

/**
 * 登录表单本体（登录注册一体）。
 *
 * 原先它是 `/login` 独立页（`pages/auth/login.tsx`）的全部内容，页面自己 `navigate(next)`
 * 决定去向；现在由工作台的登录弹窗承载，所以这里**不再碰路由**：
 * - 成功后只回调 `onSuccess()`，去哪儿由宿主按 `next` / 来源页决定；
 * - 「忘记密码？」也不跳页面，就地切到弹窗里的找回密码表单（`interceptAuthLink` 带 `mode: "recovery"`）；
 * - 「已登录就别再看这张表单」的兜底也上移到宿主（那是弹窗的开关语义，不是表单的）。
 *
 * 上游 v1.8.2 把注册合并进登录：密码登录时账号不存在且允许注册，服务端返回
 * `account_not_registered`，表单**原地**补齐注册所需信息（确认密码、邮箱或验证码、服务协议）
 * 后创建账号并登录——不再让用户去另一个页签重新填一遍已经填过的东西。
 */
export function LoginForm({ next, onSuccess }: { next: string; onSuccess: () => void }) {
    const [params] = useSearchParams();
    const { message } = App.useApp();
    const brandName = useAppearanceStore((state) => state.appearance.brandName) || "平台";
    const [settings, setSettings] = useState<AuthSettings | null>(null);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [email, setEmail] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [methods, setMethods] = useState<VerificationMethod[]>([]);
    const [method, setMethod] = useState<"password" | VerificationMethod>("password");
    const [verification, setVerification] = useState({ ...emptyVerification });
    const [registerMethod, setRegisterMethod] = useState<VerificationMethod | null>(null);
    const [registerVerification, setRegisterVerification] = useState({ ...emptyVerification });
    const [pending, setPending] = useState<PendingRegistration | null>(null);
    const [agreementAccepted, setAgreementAccepted] = useState(false);
    const [agreementOpen, setAgreementOpen] = useState(false);
    const [retryCountdown, setRetryCountdown] = useState(0);
    // 推广码由登录路由从 ?ref= 写入会话缓存；弹窗与独立页面都从这里读取。
    const [referralCode] = useState(readReferralCode);
    const forgotPasswordURL = `/forgot-password?next=${encodeURIComponent(next)}`;

    useEffect(() => {
        void getAuthSettings()
            .then((value) => {
                setSettings(value);
                setMethods(verificationMethods(value, "login"));
            })
            .catch((error) => {
                // 这是登录方式的展示配置读取：失败时明确隐藏第三方入口，
                // 账号密码登录仍可用；不能无痕地把配置读取失败当成成功。
                console.warn("读取登录方式配置失败，已隐藏第三方登录入口", error);
            });
        const oauthError = params.get("oauth_error");
        if (oauthError) message.error(oauthError);
    }, [message, params]);

    useEffect(() => {
        if (retryCountdown <= 0) return;
        const timer = window.setInterval(() => setRetryCountdown((value) => Math.max(0, value - 1)), 1000);
        return () => window.clearInterval(timer);
    }, [retryCountdown]);

    const canRegister = Boolean(settings && (settings.firstUser || settings.registrationEnabled));
    const verificationRequired = Boolean(settings && registrationVerificationRequired(settings));
    const registerMethods = settings && verificationRequired ? verificationMethods(settings, "register") : [];
    const activeRegisterMethod = registerMethod && registerMethods.includes(registerMethod) ? registerMethod : registerMethods[0];
    const verificationUnavailable = Boolean(pending && verificationRequired && !activeRegisterMethod);
    // 验证方式自带邮箱输入时不再重复显示；短信验证时邮箱作为可选或必填的附加信息。
    // 首用户（建管理员）也要能填邮箱：本地注册表单一直允许，别在合并后把它弄丢。
    const showEmailField = Boolean(pending && pending.accountKind === "username" && activeRegisterMethod !== "email" && activeRegisterMethod !== "sms_email");
    const emailRequired = Boolean(settings?.emailRequired);
    const agreement = agreementFromSettings(settings, brandName);
    // 协议行只在拿到设置后才渲染（协议名来自后台配置）。读取失败时必须放行提交：
    // 否则屏幕上没有任何可勾的框，主按钮却永远点不动，等于把登录锁死。
    const agreementBlocked = Boolean(settings) && !agreementAccepted;

    const finish = async (successText: string) => {
        const { applyUserSession } = await import("@/lib/user-session");
        await applyUserSession(await getAuthSession());
        message.success(successText);
        onSuccess();
    };

    const startRegistration = (accountKind: PendingRegistration["accountKind"]) => {
        const account = username.trim();
        setPending({ accountKind });
        setConfirmPassword("");
        setEmail(accountKind === "email" ? account : "");
        // 邮箱账号直接带入验证码表单，用户只需获取验证码。
        setRegisterVerification({ ...emptyVerification, email: accountKind === "email" ? account : "" });
    };

    const cancelRegistration = () => {
        setPending(null);
        setConfirmPassword("");
        setRegisterVerification({ ...emptyVerification });
    };

    const submitLogin = async () => {
        if (method === "password") await login({ username: username.trim(), password, autoRegister: canRegister });
        else {
            if (!verification.ticket) throw new Error("请先获取本次登录验证码");
            await loginVerification(verification);
        }
    };

    const submitRegistration = async (current: PendingRegistration) => {
        if (!agreementAccepted) throw new Error(`请先同意${agreement.title}`);
        if (password !== confirmPassword) throw new Error("两次输入的密码不一致");
        if (verificationRequired && !registerVerification.ticket) throw new Error("请先获取本次注册验证码");
        const account = username.trim();
        const contactEmail = current.accountKind === "email" ? account : email.trim();
        if (emailRequired && !settings?.firstUser && !contactEmail && !registerVerification.email) throw new Error("请填写邮箱");
        const contact = verificationRequired ? { ...registerVerification, email: registerVerification.email || contactEmail } : { email: contactEmail };
        try {
            await register({
                username: current.accountKind === "username" ? account : "",
                ...contact,
                password,
                acceptedTerms: agreementAccepted,
                ...(referralCode ? { referralCode } : {}),
            });
        } catch (error) {
            if (error instanceof ApiError && error.status === 429) setRetryCountdown(Math.max(1, Math.ceil((error.retryAfterMs ?? 60000) / 1000)));
            throw error;
        }
        clearReferralCode();
    };

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (submitting || retryCountdown > 0) return;
        // 协议行现在两种状态都在（登录 / 补注册），所以同意必须在这里统一把关：
        // 按钮虽然会置灰，但输入框里按回车、或设置还没读回来时，都可能绕过 disabled。
        if (agreementBlocked) {
            message.warning(`请先阅读并同意《${agreement.title}》`);
            return;
        }
        setSubmitting(true);
        try {
            if (pending) {
                await submitRegistration(pending);
                if (!settings?.firstUser) window.sessionStorage.setItem("yingce:model-setup-guide", "1");
                await finish(settings?.firstUser ? "管理员账号已创建" : "注册成功，已自动登录");
                return;
            }
            try {
                await submitLogin();
            } catch (error) {
                // 账号不存在是「可以继续」的分支，不是错误：就地进入补充注册。
                if (error instanceof ApiError && error.reason === "account_not_registered" && canRegister) {
                    startRegistration(error.details?.accountKind === "email" ? "email" : "username");
                    return;
                }
                throw error;
            }
            await finish("登录成功");
        } catch (error) {
            message.error(error instanceof Error ? error.message : pending ? "注册失败" : "登录失败");
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
        <form onSubmit={submit} className="flex flex-col gap-2.5">
            {/* 这两条和下面的「该账号还不存在」共用同一套主色面板材质（.auth-scene-notice /
                .auth-scene-pending 在 globals.css 里是一组），语义靠图标形状区分，
                不再用 --palette-status-* 的蓝 / 琥珀：经典皮肤是纯中性的，
                那点彩色是全屏唯一的异色，换肤也不会跟随。 */}
            {settings?.firstUser && !pending ? (
                <div className="auth-scene-notice">
                    <span className="auth-scene-notice-mark" aria-hidden="true">
                        <Info className="size-3" />
                    </span>
                    <span>首个账号自动成为管理员，邮箱验证码暂不要求。</span>
                </div>
            ) : null}
            {/*
              「账号不存在 → 就地把注册补完」是新用户唯一的分岔点，因此这里不再画成一条
              状态色（原先取的是 status-loading 蓝，是 antd Alert 的语言，跟本项目的中性
              皮肤打架）。现在是一个主色描边面板：底色与描边都取自 --workspace-accent
              （= 皮肤主色），换肤后自动跟随。可访问性上给 role="status"，
              进入补充注册这一步时读屏会播报。
            */}
            {pending ? (
                <div className="auth-scene-pending" role="status">
                    <span className="auth-scene-pending-mark" aria-hidden="true">
                        <UserRoundPlus className="size-3" />
                    </span>
                    <p className="auth-scene-pending-title">该账号还不存在</p>
                    <p className="auth-scene-pending-hint">补全信息后立即创建并登录</p>
                    {/* 「换一个账号」原先只是句号后的一小段同色链接，几乎是隐形的；
                        改成带描边和图标的胶囊按钮——这是唯一的退路，必须一眼看到。
                        DOM 里排在标题和说明之后（读屏顺序 = 标题 → 说明 → 操作），
                        视觉上靠 grid-area 摆回右上角。 */}
                    <button type="button" className="auth-scene-pending-switch" onClick={cancelRegistration} disabled={submitting}>
                        <ArrowLeftRight className="size-3" aria-hidden="true" />
                        换一个账号
                    </button>
                </div>
            ) : null}
            {/* 这一条是真·异常（注册流程走不下去），但配色仍跟随主色面板：
                三角图标 + 「请联系管理员」的措辞已经足够说明严重性，
                同屏出现两条不同色相的横幅反而是噪音。 */}
            {verificationUnavailable ? (
                <div className="auth-scene-notice" role="alert">
                    <span className="auth-scene-notice-mark" aria-hidden="true">
                        <TriangleAlert className="size-3" />
                    </span>
                    <span>当前没有可用的注册验证方式，请联系管理员检查短信及邮件配置。</span>
                </div>
            ) : null}
            {!pending && methods.length > 0 && (
                <Segmented
                    block
                    aria-label="登录方式"
                    value={method}
                    disabled={submitting}
                    options={[{ value: "password", label: "密码登录" }, ...methods.map((value) => ({ value, label: methodLabels[value] }))]}
                    onChange={(value) => {
                        setMethod(value as typeof method);
                        setVerification({ ...emptyVerification });
                    }}
                />
            )}
            {!pending && method !== "password" ? (
                <VerificationFields key={method} purpose="login" method={method} value={verification} onChange={setVerification} disabled={submitting} />
            ) : (
                <>
                    {/* 输入框的底色 / 描边 / 文字色 / 占位符全部由 globals.css 的 `.auth-scene-card` 段按主题给出，
                    这里不要再挂 `text-white`、`bg-white/5` 这类工具类：它们是旧独立登录页（深色）的遗留，
                    而那段选择器用了 `:where()`（特异性 0），浅色主题下会被工具类反过来盖成白底白字。 */}
                    <Input
                        id="login-account"
                        aria-label="用户名或邮箱"
                        size="large"
                        prefix={<UserRound className="auth-scene-icon size-4" />}
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        placeholder="用户名或邮箱"
                        autoComplete="username"
                        required
                        // 进入补充注册后账号锁定，改账号需要点「换一个账号」回到登录。
                        readOnly={Boolean(pending)}
                        disabled={submitting}
                    />
                    <Input.Password
                        id="login-password"
                        aria-label="密码"
                        size="large"
                        prefix={<LockKeyhole className="auth-scene-icon size-4" />}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder={pending ? "设置登录密码（至少 8 位）" : "密码"}
                        autoComplete={pending ? "new-password" : "current-password"}
                        required
                        disabled={submitting}
                    />
                    {pending ? (
                        <>
                            <Input.Password
                                aria-label="确认密码"
                                size="large"
                                prefix={<LockKeyhole className="auth-scene-icon size-4" />}
                                value={confirmPassword}
                                onChange={(event) => setConfirmPassword(event.target.value)}
                                placeholder="再次输入密码"
                                autoComplete="new-password"
                                required
                                autoFocus
                                disabled={submitting}
                            />
                            {showEmailField ? (
                                <Input
                                    aria-label={emailRequired ? "邮箱（必填）" : "邮箱（选填）"}
                                    size="large"
                                    type="email"
                                    prefix={<Mail className="auth-scene-icon size-4" />}
                                    value={email}
                                    onChange={(event) => setEmail(event.target.value)}
                                    placeholder={emailRequired ? "用于登录与安全验证，必填" : "用于找回密码，选填"}
                                    autoComplete="email"
                                    required={emailRequired}
                                    disabled={submitting}
                                />
                            ) : null}
                            {registerMethods.length > 1 ? (
                                <Segmented
                                    block
                                    aria-label="注册验证方式"
                                    value={activeRegisterMethod}
                                    disabled={submitting}
                                    options={registerMethods.map((value) => ({ value, label: methodLabels[value] }))}
                                    onChange={(value) => {
                                        setRegisterMethod(value as VerificationMethod);
                                        setRegisterVerification({ ...emptyVerification, email: pending.accountKind === "email" ? username.trim() : "" });
                                    }}
                                />
                            ) : null}
                            {activeRegisterMethod ? <VerificationFields key={activeRegisterMethod} purpose="register" method={activeRegisterMethod} value={registerVerification} onChange={setRegisterVerification} disabled={submitting} /> : null}
                        </>
                    ) : (
                        <div className="-my-1 flex justify-end">
                            {/* 就地切到找回密码表单：`/forgot-password` 是空壳路由，真跳过去会卸载
                                整棵页面树再被宿主换回来（空白几帧）。href 保留给中键 / 新标签页。 */}
                            <Link to={forgotPasswordURL} onClick={(event) => interceptAuthLink(event, { mode: "recovery", next })} className="auth-scene-link inline-flex min-h-6 items-center rounded-sm text-xs font-medium transition-colors">
                                忘记密码？
                            </Link>
                        </div>
                    )}
                </>
            )}
            {/* 协议行在登录与补注册两种状态下都要有：登录页同样需要用户明示同意
                （勾选状态同时决定提交按钮是否可用，也决定 Linux.do 登录是否带上同意标记）。 */}
            {settings ? (
                <div className="auth-agreement-row" data-accepted={agreementAccepted ? "true" : "false"}>
                    <Checkbox checked={agreementAccepted} onChange={(event) => setAgreementAccepted(event.target.checked)}>
                        <span className="auth-agreement-label">我已阅读并同意</span>
                    </Checkbox>
                    <button type="button" className="auth-agreement-link" onClick={() => setAgreementOpen(true)}>
                        《{agreement.title}》
                    </button>
                </div>
            ) : null}
            <Button type="primary" htmlType="submit" size="large" block loading={submitting} disabled={verificationUnavailable || retryCountdown > 0 || agreementBlocked} className="h-12 rounded-2xl font-medium text-[15px] border-0 mt-1">
                {retryCountdown > 0 ? `${retryCountdown} 秒后可重试` : pending ? "创建账号并登录" : "登录并进入创作"}
            </Button>
            {/* 登录与注册已合成一张表单：不给提示的话，新用户会以为这里只能登录。 */}
            {!pending && canRegister && method === "password" ? <p className="auth-scene-muted text-center text-xs leading-5">未注册的账号会在确认密码后自动创建</p> : null}
            {/* 第三方登录不再配「或」分隔线：只有两个区块时，一条分割线带来的
                视觉噪音大于它的分组作用，改用按钮间距区分。 */}
            {settings?.linuxdoEnabled && !pending ? (
                <Button size="large" block icon={<LinuxDOIcon />} href={linuxDOLoginURL(next, agreementAccepted || undefined)} className="h-12 rounded-2xl">
                    使用 Linux.do 登录
                </Button>
            ) : null}
            <AgreementDialog open={agreementOpen} title={agreement.title} paragraphs={agreement.paragraphs} onClose={() => setAgreementOpen(false)} />
        </form>
    );
}
