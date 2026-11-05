import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input, Skeleton } from "antd";
import { ChevronLeft, ChevronRight, CircleAlert, Coins, CreditCard, History, RefreshCw, TicketCheck, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { WalletTopupPanel, type TopupCategory } from "@/components/layout/workspace-wallet-topup";
import { usePaymentOrderFlow } from "@/components/payment/use-payment-order-flow";
import { AppModal } from "@/components/ui/product/app-modal";
import { formatCredits } from "@/constant/credits";
import { currentLocale } from "@/i18n";
import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountFileStorageUsageQueryKey, accountStorageMeter } from "@/lib/account-storage-usage";
import { generationErrorMessage } from "@/lib/generation-error";
import { listPaymentProviders, listTopupProducts, type PaymentOrder, type PaymentProvider, type TopupProduct, type TopupProductKind } from "@/services/api/payments";
import { getWallet, redeemCredits, type CreditLedgerEntry, type WalletSummary } from "@/services/api/wallet";
import { cn } from "@/lib/utils";
import { openWorkspaceWallet, WORKSPACE_WALLET_OPEN_EVENT, type WorkspaceWalletOpenDetail } from "@/lib/workspace-wallet";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";

type WalletModalTab = "topup" | "redeem" | "history";

export function WorkspaceWalletHost() {
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const loggedIn = useUserStore((state) => Boolean(state.user));
    const { pathname, search } = useLocation();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [openDetail, setOpenDetail] = useState<WorkspaceWalletOpenDetail>({});

    // 积分关闭时仍要能打开充值页购买存储空间，只是隐藏积分余额、兑换和积分记录。
    const applyOpen = (detail: WorkspaceWalletOpenDetail = {}) => {
        setOpenDetail(detail);
        setOpen(true);
    };

    useEffect(() => {
        const handleOpen = (raw: Event) => {
            applyOpen((raw as CustomEvent<WorkspaceWalletOpenDetail>).detail || {});
        };
        window.addEventListener(WORKSPACE_WALLET_OPEN_EVENT, handleOpen);
        return () => window.removeEventListener(WORKSPACE_WALLET_OPEN_EVENT, handleOpen);
    }, []);

    useEffect(() => {
        if (pathname !== "/wallet") return;
        const params = new URLSearchParams(search);
        openWorkspaceWallet({
            paymentOrderId: params.get("paymentOrder") || undefined,
            paymentInvalid: params.get("payment") === "invalid",
        });
        navigate("/", { replace: true });
    }, [navigate, pathname, search]);

    if (!loggedIn) return null;
    return (
        <WorkspaceWalletModal
            open={open}
            creditsEnabled={creditsEnabled}
            initialTab={openDetail.tab}
            initialCategory={openDetail.category}
            pendingPaymentOrderId={openDetail.paymentOrderId}
            paymentInvalid={openDetail.paymentInvalid}
            onClose={() => {
                setOpen(false);
                setOpenDetail({});
            }}
        />
    );
}

export function WorkspaceWalletModal({
    open,
    onClose,
    creditsEnabled = true,
    initialTab,
    initialCategory,
    pendingPaymentOrderId,
    paymentInvalid,
}: {
    open: boolean;
    onClose: () => void;
    creditsEnabled?: boolean;
    initialTab?: WalletModalTab;
    initialCategory?: TopupCategory;
    pendingPaymentOrderId?: string;
    paymentInvalid?: boolean;
}) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const redeemPurchaseUrl = useAppearanceStore((state) => state.appearance.redeemPurchaseUrl);
    const [tab, setTab] = useState<WalletModalTab>("topup");
    const [focusKind, setFocusKind] = useState<TopupProductKind | undefined>();
    const [focusToken, setFocusToken] = useState(0);
    const [wallet, setWallet] = useState<WalletSummary | null>(null);
    const [walletLoading, setWalletLoading] = useState(false);
    const [walletError, setWalletError] = useState("");
    const [page, setPage] = useState(1);
    const [products, setProducts] = useState<TopupProduct[]>([]);
    const [providers, setProviders] = useState<PaymentProvider[]>([]);
    const [paymentsLoading, setPaymentsLoading] = useState(false);
    const [selectedProductId, setSelectedProductId] = useState("");
    const [selectedProviderId, setSelectedProviderId] = useState("");
    const [code, setCode] = useState("");
    const [redeeming, setRedeeming] = useState(false);
    const requestSequence = useRef(0);
    const storageQuery = useAccountFileStorageUsage(open);
    const storageMeter = accountStorageMeter(storageQuery.data);

    const selectedProduct = useMemo(() => products.find((item) => item.id === selectedProductId), [products, selectedProductId]);
    const selectedProvider = useMemo(() => providers.find((item) => item.id === selectedProviderId), [providers, selectedProviderId]);
    const activeTab: WalletModalTab = creditsEnabled ? tab : "topup";

    const reloadWallet = async (targetPage = page) => {
        if (!creditsEnabled) return;
        const sequence = ++requestSequence.current;
        setWalletLoading(true);
        setWalletError("");
        try {
            const result = await getWallet(targetPage, 20, "all");
            if (sequence === requestSequence.current) setWallet(result);
        } catch (error) {
            if (sequence === requestSequence.current) setWalletError(error instanceof Error ? error.message : t("account.wallet.loadFailed"));
        } finally {
            if (sequence === requestSequence.current) setWalletLoading(false);
        }
    };

    useEffect(() => {
        if (!open) return;
        setTab(initialTab || "topup");
        setFocusKind(initialCategory && initialCategory !== "all" ? initialCategory : undefined);
        setPage(1);
        void reloadWallet(1);
        setPaymentsLoading(true);
        Promise.all([listTopupProducts(), listPaymentProviders()])
            .then(([productResult, providerResult]) => {
                const enabledProducts = productResult.products.filter((item) => item.enabled);
                const usableProviders = providerResult.providers.filter((item) => item.enabled && item.pluginEnabled && item.configured);
                setProducts(enabledProducts);
                setProviders(usableProviders);
                // 从容量入口进入时优先选中存储空间套餐。
                const preferred = enabledProducts.filter((item) => !initialCategory || initialCategory === "all" || item.kind === initialCategory);
                setSelectedProductId((current) =>
                    current && enabledProducts.some((item) => item.id === current) && !initialCategory ? current : preferred.find((item) => item.canPurchase)?.id || enabledProducts.find((item) => item.canPurchase)?.id || "",
                );
                setSelectedProviderId((current) => current || usableProviders[0]?.id || "");
            })
            .catch((error) => message.error(error instanceof Error ? error.message : t("account.wallet.configLoadFailed")))
            .finally(() => setPaymentsLoading(false));
    }, [open]);

    useEffect(() => {
        if (!open || !paymentInvalid) return;
        message.error(t("account.wallet.paymentInvalid"));
    }, [open, paymentInvalid]);

    const announceWalletUpdated = async () => {
        setPage(1);
        await reloadWallet(1);
        window.dispatchEvent(new CustomEvent("wallet:updated"));
    };

    const announceGranted = async (order: PaymentOrder) => {
        if (order.productKind === "storage") {
            await queryClient.invalidateQueries({ queryKey: accountFileStorageUsageQueryKey });
            return;
        }
        await announceWalletUpdated();
    };

    const payment = usePaymentOrderFlow({ onGranted: announceGranted });

    useEffect(() => {
        payment.resetIdempotency();
    }, [selectedProductId, selectedProviderId]);

    useEffect(() => {
        if (!open || !pendingPaymentOrderId) return;
        void payment.showOrder(pendingPaymentOrderId);
    }, [open, pendingPaymentOrderId]);

    const redeem = async () => {
        const normalized = code.trim().toLowerCase();
        if (normalized.length !== 32) {
            message.error(t("account.wallet.redeemCodeInvalid"));
            return;
        }
        setRedeeming(true);
        try {
            await redeemCredits(normalized);
            setCode("");
            await announceWalletUpdated();
            message.success(t("account.wallet.redeemSuccess"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.wallet.redeemFailed"));
        } finally {
            setRedeeming(false);
        }
    };

    const startPayment = async () => {
        if (!selectedProduct || !selectedProvider) {
            message.error("请选择套餐和支付方式");
            return;
        }
        if (!selectedProduct.canPurchase) {
            message.error(t("account.wallet.productUnavailable"));
            return;
        }
        await payment.start(selectedProduct.id, selectedProvider.id);
    };

    // 定位到某类套餐：滚动到分组，并在当前选中项不属于该类时改选该类第一个可买套餐。
    const focusProducts = (kind: TopupProductKind) => {
        setTab("topup");
        setFocusKind(kind);
        setFocusToken((value) => value + 1);
        if (selectedProduct?.kind === kind) return;
        const next = products.find((item) => item.kind === kind && item.canPurchase);
        if (next) setSelectedProductId(next.id);
    };

    const available = wallet?.account.availableMicrocredits ?? 0;
    const totalPages = Math.max(1, Math.ceil((wallet?.total || 0) / 20));

    return (
        <>
            <AppModal flush open={open} title={null} footer={null} centered width="min(920px, calc(100vw - 28px))" onCancel={onClose} rootClassName="workspace-wallet-modal">
                <div className="workspace-wallet-shell">
                    <header className="workspace-wallet-header">
                        <div>
                            <span className="workspace-wallet-kicker">
                                <Coins />
                                {creditsEnabled ? t("nav.tools.wallet") : t("account.wallet.topupCenter")}
                            </span>
                            <h2>{creditsEnabled ? t("account.wallet.title") : t("account.wallet.titleStorage")}</h2>
                            <p>{creditsEnabled ? t("account.wallet.description") : t("account.wallet.descriptionStorage")}</p>
                        </div>
                        <div className="workspace-wallet-stats">
                            {creditsEnabled ? (
                                <div className="workspace-wallet-balance">
                                    <span className="wallet-stat-label">可用积分</span>
                                    <strong>{wallet ? formatCredits(available, 6) : "--"}</strong>
                                    <small>{t("account.wallet.reserved", { amount: wallet ? formatCredits(wallet.account.reservedMicrocredits, 6) : "--" })}</small>
                                </div>
                            ) : null}
                            <button type="button" className="workspace-wallet-balance is-storage" aria-label="查看存储空间套餐" onClick={() => focusProducts("storage")}>
                                <span className="wallet-stat-label">存储空间</span>
                                <strong>{storageQuery.data ? `${storageMeter.usedLabel} / ${storageMeter.totalLabel}` : "--"}</strong>
                                <span className={cn("wallet-topup-storage-track", storageMeter.tone !== "ok" && `is-${storageMeter.tone}`)} aria-hidden="true">
                                    <span style={{ width: `${storageMeter.percent}%` }} />
                                </span>
                                <small>
                                    {storageMeter.state === "read_only"
                                        ? t("account.wallet.storageReadOnly")
                                        : storageMeter.state === "grace"
                                          ? t("account.wallet.storageGrace")
                                          : storageMeter.purchasedLabel
                                            ? t("account.wallet.storagePurchased", { size: storageMeter.purchasedLabel })
                                            : t("account.layout.storage.remaining", { size: storageMeter.remainingLabel })}
                                </small>
                            </button>
                        </div>
                    </header>

                    {creditsEnabled ? (
                        <div className="workspace-wallet-tabs" role="tablist" aria-label={t("nav.tools.wallet")}>
                            <button type="button" role="tab" aria-selected={activeTab === "topup"} onClick={() => setTab("topup")}>
                                <WalletCards />
                                {t("account.wallet.tabTopup")}
                            </button>
                            <button type="button" role="tab" aria-selected={activeTab === "redeem"} onClick={() => setTab("redeem")}>
                                <TicketCheck />
                                {t("account.wallet.tabRedeem")}
                            </button>
                            <button type="button" role="tab" aria-selected={activeTab === "history"} onClick={() => setTab("history")}>
                                <History />
                                {t("account.wallet.tabHistory")}
                            </button>
                        </div>
                    ) : null}

                    {activeTab === "topup" ? (
                        <WalletTopupPanel
                            loading={paymentsLoading}
                            products={products}
                            providers={providers}
                            focusKind={focusKind}
                            focusToken={focusToken}
                            selectedProduct={selectedProduct}
                            onSelectProduct={setSelectedProductId}
                            selectedProviderId={selectedProviderId}
                            onSelectProvider={setSelectedProviderId}
                            creating={payment.creating}
                            onPay={() => void startPayment()}
                            onGoRedeem={() => setTab("redeem")}
                        />
                    ) : activeTab === "redeem" ? (
                        <div className="workspace-wallet-content is-redeem">
                            <section className="workspace-wallet-section is-redeem">
                                <div className="workspace-wallet-section-heading">
                                    <div>
                                        <h3>卡密兑换</h3>
                                        <p>
                                            输入 32 位充值卡密，校验通过后对应权益立即注入当前账号。
                                            {redeemPurchaseUrl ? (
                                                <a className="workspace-wallet-redeem-link" href={redeemPurchaseUrl} target="_blank" rel="noopener noreferrer">
                                                    获取卡密
                                                </a>
                                            ) : null}
                                        </p>
                                    </div>
                                    <TicketCheck />
                                </div>
                                <div className="workspace-wallet-redeem-row">
                                    <Input size="large" value={code} maxLength={32} placeholder="输入 32 位兑换码" onChange={(event) => setCode(event.target.value.replace(/\s/g, ""))} onPressEnter={() => void redeem()} />
                                    <Button type="primary" size="large" loading={redeeming} disabled={code.trim().length !== 32} onClick={() => void redeem()}>
                                        确认兑换
                                    </Button>
                                </div>
                            </section>
                        </div>
                    ) : (
                        <div className="workspace-wallet-content is-history">
                            <div className="workspace-wallet-history-toolbar">
                                <div>
                                    <h3>{t("account.wallet.tabHistory")}</h3>
                                    <p>{t("account.wallet.historyDescription")}</p>
                                </div>
                                <Button type="text" icon={<RefreshCw />} loading={walletLoading} onClick={() => void reloadWallet(page)}>
                                    {t("common.refresh")}
                                </Button>
                            </div>
                            <div className="workspace-wallet-history-scroll thin-scrollbar">
                                {walletError ? (
                                    <div className="workspace-wallet-inline-state is-error">
                                        <CircleAlert />
                                        <div>
                                            <strong>{t("account.wallet.historyLoadFailed")}</strong>
                                            <span>{walletError}</span>
                                        </div>
                                        <Button onClick={() => void reloadWallet(page)}>{t("common.retry")}</Button>
                                    </div>
                                ) : walletLoading && !wallet ? (
                                    <Skeleton active paragraph={{ rows: 6 }} />
                                ) : wallet?.entries.length ? (
                                    <div className="workspace-wallet-ledger">
                                        {wallet.entries.map((entry) => (
                                            <WalletLedgerRow key={entry.id} entry={entry} />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="workspace-wallet-empty">
                                        <History />
                                        <strong>{t("account.wallet.historyEmpty")}</strong>
                                        <span>{t("account.wallet.historyEmptyHint")}</span>
                                    </div>
                                )}
                            </div>
                            <div className="workspace-wallet-pagination">
                                <span>{t("account.wallet.pageOf", { page, total: totalPages })}</span>
                                <button
                                    type="button"
                                    disabled={page <= 1 || walletLoading}
                                    aria-label={t("account.layout.pagination.prev")}
                                    onClick={() => {
                                        const next = page - 1;
                                        setPage(next);
                                        void reloadWallet(next);
                                    }}
                                >
                                    <ChevronLeft />
                                </button>
                                <button
                                    type="button"
                                    disabled={page >= totalPages || walletLoading}
                                    aria-label={t("account.layout.pagination.next")}
                                    onClick={() => {
                                        const next = page + 1;
                                        setPage(next);
                                        void reloadWallet(next);
                                    }}
                                >
                                    <ChevronRight />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </AppModal>

            {payment.dialog}
        </>
    );
}

function WalletLedgerRow({ entry }: { entry: CreditLedgerEntry }) {
    const { t } = useTranslation();
    const positive = entry.amountMicrocredits > 0;
    const note = entry.note ? generationErrorMessage(entry.note) : "";
    const title =
        entry.type === "consume"
            ? t("account.wallet.ledger.consume")
            : entry.type === "refund"
              ? t("account.wallet.ledger.refund")
              : entry.type === "payment_topup"
                ? t("account.wallet.ledger.paymentTopup")
                : entry.type === "redeem"
                  ? t("account.wallet.ledger.redeem")
                  : entry.type === "referral_commission"
                    ? t("account.wallet.ledger.referral")
                    : note || t("account.wallet.ledger.adjust");
    return (
        <article className="workspace-wallet-ledger-row">
            <span className={cn("workspace-wallet-ledger-icon", positive ? "is-income" : "is-consume")}>{positive ? <Coins /> : <CreditCard />}</span>
            <div>
                <strong>{title}</strong>
                <span>{[entry.scene, entry.model, note].filter(Boolean).join(" · ") || t("account.wallet.ledger.change")}</span>
            </div>
            <time>{new Date(entry.createdAt).toLocaleString(currentLocale(), { hour12: false })}</time>
            <b className={positive ? "is-income" : "is-consume"}>
                {positive ? "+" : ""}
                {formatCredits(entry.amountMicrocredits, 6)}
            </b>
        </article>
    );
}
