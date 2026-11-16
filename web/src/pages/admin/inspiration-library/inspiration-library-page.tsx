import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button } from "antd";
import type { ColumnsType } from "antd/es/table";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
    getAdminInspirationLibraryRecord,
    importAdminInspirationLibrary,
    listAdminInspirationLibrary,
    reviewAdminInspirationLibrary,
    type InspirationLibraryRecord,
    type InspirationLibraryStatus,
    type LibraryCandidate,
} from "@/services/api/inspiration-library-admin";
import { useUserStore } from "@/stores/use-user-store";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty, PaginationBar } from "../components/admin-ui";
import { AdminSegmented } from "../ui/controls";
import { AdminDrawer } from "../ui/overlays";
import { LibraryImportModal } from "./library-import-modal";
import { LibraryReview } from "./library-review";
import "./inspiration-library.css";

const statusLabels: Record<InspirationLibraryStatus, string> = { pending: "待审核", approved: "已批准", rejected: "已拒绝/下架" };
const statusTones = { pending: "warning", approved: "success", rejected: "error" } as const;
const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : "请求失败，请重试");

export default function InspirationLibraryAdminPage() {
    const actorScope = useUserStore((state) => state.user?.id ?? "");
    const [status, setStatus] = useState<InspirationLibraryStatus>("pending");
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [slug, setSlug] = useState("");
    const [importOpen, setImportOpen] = useState(false);
    const [working, setWorking] = useState(false);
    const [actionError, setActionError] = useState("");
    const [notice, setNotice] = useState("");
    const activeScope = useRef(actorScope);
    activeScope.current = actorScope;
    const action = useRef<AbortController | null>(null);
    const queryClient = useQueryClient();
    const detailKey = ["admin", "inspiration-library", "detail", actorScope, slug];
    const list = useQuery({ queryKey: ["admin", "inspiration-library", "list", actorScope, status, page, limit], queryFn: ({ signal }) => listAdminInspirationLibrary({ status, page, limit }, signal), retry: false });
    const detail = useQuery({ queryKey: detailKey, queryFn: ({ signal }) => getAdminInspirationLibraryRecord(slug, signal), enabled: Boolean(slug), retry: false, staleTime: 0 });

    useEffect(() => {
        action.current?.abort();
        action.current = null;
        setSlug("");
        setImportOpen(false);
        setWorking(false);
        setActionError("");
        setNotice("");
        return () => {
            action.current?.abort();
            action.current = null;
        };
    }, [actorScope]);

    const invalidate = () => {
        void queryClient.invalidateQueries({ queryKey: ["admin", "inspiration-library", "list"] });
        void queryClient.invalidateQueries({ queryKey: ["public", "inspirations"] });
    };
    const runWrite = async <T,>(task: (signal: AbortSignal) => Promise<T>, after: (result: T, signal: AbortSignal) => Promise<void> | void) => {
        if (action.current) return;
        const controller = new AbortController();
        const scope = actorScope;
        action.current = controller;
        setWorking(true);
        setActionError("");
        setNotice("");
        try {
            const result = await task(controller.signal);
            if (controller.signal.aborted || activeScope.current !== scope) return;
            await after(result, controller.signal);
        } catch (cause) {
            if (!controller.signal.aborted && activeScope.current === scope) setActionError(errorText(cause));
        } finally {
            if (action.current === controller) {
                action.current = null;
                setWorking(false);
            }
        }
    };
    const importItems = (items: LibraryCandidate[]) =>
        runWrite(
            (signal) => importAdminInspirationLibrary(items, signal),
            (result) => {
                setNotice(`候选已导入：新增 ${result.created}，更新待审 ${result.updated}，内容未变 ${result.unchanged}`);
                invalidate();
            },
        );
    const saveEvidence = (candidate: LibraryCandidate) =>
        runWrite(
            (signal) => importAdminInspirationLibrary([candidate], signal),
            async (result, signal) => {
                setNotice(`候选证据已提交：更新待审 ${result.updated}，内容未变 ${result.unchanged}；这不是批准`);
                invalidate();
                try {
                    const record = await getAdminInspirationLibraryRecord(candidate.slug, signal);
                    if (!signal.aborted && activeScope.current === actorScope) queryClient.setQueryData(detailKey, record);
                } catch (cause) {
                    if (!signal.aborted && activeScope.current === actorScope) setActionError(`候选已提交，但新版本读取失败：${errorText(cause)}；请重新读取后再审核`);
                }
            },
        );
    const review = (action: "approve" | "reject", reason: string) => {
        const record = detail.data;
        if (!record || detail.isFetching || !reason.trim()) return Promise.resolve();
        return runWrite(
            (signal) => reviewAdminInspirationLibrary(record.slug, { revision: record.revision, action, reason }, signal),
            (next) => {
                queryClient.setQueryData(detailKey, next);
                setNotice(action === "approve" ? `版本 ${next.revision} 已批准` : "素材已拒绝/下架，不再公开展示");
                invalidate();
            },
        );
    };
    const openRecord = (item: InspirationLibraryRecord) => {
        setActionError("");
        setNotice("");
        setSlug(item.slug);
    };
    const columns: ColumnsType<InspirationLibraryRecord> = [
        {
            title: "候选素材",
            key: "title",
            render: (_, item) => (
                <div>
                    <span className="font-medium">{item.title}</span>
                    <p className="inspiration-library-note">
                        {item.mode === "video" ? "视频" : "图片"} · {item.model || "无模型标注"} · {item.slug}
                    </p>
                </div>
            ),
        },
        {
            title: "作者/来源",
            key: "source",
            render: (_, item) => (
                <div className="inspiration-library-source">
                    {item.author || "未填作者"}
                    <p>{item.sourceUrl || "未填来源"}</p>
                </div>
            ),
        },
        {
            title: "状态/版本",
            key: "status",
            width: 150,
            render: (_, item) => (
                <>
                    <AdminStatusBadge label={statusLabels[item.status]} tone={statusTones[item.status]} />
                    <p className="inspiration-library-note">版本 {item.revision}</p>
                </>
            ),
        },
        { title: "审核原因", dataIndex: "reviewReason", render: (value) => value || "—" },
        {
            title: "操作",
            key: "actions",
            width: 110,
            render: (_, item) => (
                <Button type="text" disabled={working} icon={<ShieldCheck className="size-3.5" />} onClick={() => openRecord(item)}>
                    查看审核
                </Button>
            ),
        },
    ];
    return (
        <AdminPageFrame
            title="素材授权审核"
            description="仅明确授权且逐条批准的固定版本进入白名单；本页不抓取外站，不自动批准。"
            actions={
                <Button
                    type="primary"
                    disabled={working}
                    onClick={() => {
                        setActionError("");
                        setNotice("");
                        setImportOpen(true);
                    }}
                >
                    导入候选 JSON
                </Button>
            }
            scroll
        >
            <Alert type="info" title="授权白名单，默认拒绝公开" description="提示词与展示媒体分别审查商用、转载/再分发、权利人、授权证据和必要署名。模型/作者/来源筛选不保证零竞品或版权安全。" />
            {list.isError ? (
                <Alert
                    type="error"
                    title={errorText(list.error)}
                    action={
                        <Button disabled={list.isFetching} onClick={() => void list.refetch()}>
                            重试列表
                        </Button>
                    }
                />
            ) : null}
            <AdminDataTable<InspirationLibraryRecord>
                toolbar={
                    <AdminSegmented<InspirationLibraryStatus>
                        ariaLabel="素材授权状态"
                        value={status}
                        onChange={(value) => {
                            setStatus(value);
                            setPage(1);
                        }}
                        options={Object.entries(statusLabels).map(([value, label]) => ({ value: value as InspirationLibraryStatus, label }))}
                    />
                }
                trailing={
                    <Button icon={<RefreshCw className="size-3.5" />} disabled={list.isFetching} onClick={() => void list.refetch()}>
                        刷新
                    </Button>
                }
                table={{ rowKey: "slug", columns, dataSource: list.isSuccess ? list.data.items : [], loading: list.isPending, pagination: false, scroll: { x: 760 } }}
                empty={<AdminTableEmpty title={list.isError ? "列表读取失败" : "当前状态没有素材"} description={list.isError ? "请重试；失败不代表授权库为空" : "导入只产生待审候选，核实授权后逐条批准。"} />}
                footer={
                    list.isSuccess ? (
                        <PaginationBar
                            alwaysShow
                            current={page}
                            pageSize={limit}
                            total={list.data.total}
                            pageSizeOptions={[20, 50, 100]}
                            onChange={(nextPage, nextLimit) => {
                                setPage(nextPage);
                                setLimit(nextLimit);
                            }}
                        />
                    ) : undefined
                }
            />
            <AdminDrawer
                open={Boolean(slug)}
                title="素材授权审核"
                size="large"
                onClose={() => {
                    if (!working) setSlug("");
                }}
                closable={!working}
                keyboard={!working}
                maskClosable={!working}
            >
                {detail.isPending ? <p role="status">正在读取当前候选版本…</p> : null}
                {detail.isError ? <Alert type="error" title={errorText(detail.error)} action={<Button onClick={() => void detail.refetch()}>重新读取</Button>} /> : null}
                {detail.isSuccess ? (
                    <LibraryReview
                        key={`${detail.data.slug}:${detail.data.revision}:${detail.data.contentHash}`}
                        record={detail.data}
                        working={working || detail.isFetching}
                        error={actionError}
                        notice={notice}
                        onSave={saveEvidence}
                        onReview={review}
                        onReload={() => {
                            setActionError("");
                            void detail.refetch();
                        }}
                    />
                ) : null}
            </AdminDrawer>
            {importOpen ? (
                <LibraryImportModal
                    working={working}
                    error={actionError}
                    notice={notice}
                    onClose={() => {
                        if (!working) setImportOpen(false);
                    }}
                    onImport={importItems}
                />
            ) : null}
        </AdminPageFrame>
    );
}
