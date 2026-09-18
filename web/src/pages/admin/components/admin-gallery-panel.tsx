import { App, Button, Input, Select, Switch, Upload } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Search, Upload as UploadIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { PaginationBar } from "@/pages/admin/components/admin-ui";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { deleteGalleryItem, fetchAdminGalleryItems, importGalleryItems, setGalleryItemActive, type GalleryPromptItem } from "@/services/api/gallery";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty } from "./admin-ui";

export default function AdminGalleryPanel() {
    const { message, modal } = App.useApp();
    const [keyword, setKeyword] = useState("");
    const [mediaType, setMediaType] = useState("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [items, setItems] = useState<GalleryPromptItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [importing, setImporting] = useState(false);
    const requestSequence = useRef(0);
    const debouncedKeyword = useDebouncedValue(keyword);
    const hasFilters = Boolean(keyword || mediaType !== "all");

    const load = async () => {
        const sequence = ++requestSequence.current;
        setLoading(true);
        try {
            const result = await fetchAdminGalleryItems({
                page,
                pageSize,
                keyword: debouncedKeyword || undefined,
                media_type: mediaType === "all" ? undefined : mediaType,
            });
            if (sequence !== requestSequence.current) return;
            setItems(result.items);
            setTotal(result.total);
            if (result.total > 0 && result.items.length === 0 && page > 1) setPage(1);
        } catch (error) {
            if (sequence !== requestSequence.current) return;
            message.error(error instanceof Error ? error.message : "读取画廊条目失败");
        } finally {
            if (sequence === requestSequence.current) setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, [debouncedKeyword, mediaType, page, pageSize]);

    const columns = useMemo<ColumnsType<GalleryPromptItem>>(
        () => [
            {
                title: "封面",
                dataIndex: "cover_url",
                width: 88,
                render: (url: string, record) => <img src={url} alt={record.title} className="h-12 w-12 rounded object-cover" referrerPolicy="no-referrer" />,
            },
            {
                title: "标题",
                dataIndex: "title",
                render: (title: string, record) => (
                    <div className="min-w-0">
                        <div className="truncate font-medium">{title}</div>
                        <div className="truncate text-xs text-[var(--admin-text-tertiary)]">
                            {record.model} · {record.media_type === "video" ? "视频" : "图片"}
                        </div>
                    </div>
                ),
            },
            {
                title: "状态",
                dataIndex: "is_active",
                width: 96,
                render: (active: boolean) => <AdminStatusBadge label={active ? "已上架" : "已下架"} tone={active ? "success" : "neutral"} />,
            },
            {
                title: "上架",
                dataIndex: "is_active",
                width: 88,
                render: (active: boolean, record) => (
                    <Switch
                        checked={active}
                        onChange={(next) => {
                            void setGalleryItemActive(record.id, next)
                                .then(() => {
                                    message.success(next ? "已上架" : "已下架");
                                    void load();
                                })
                                .catch((error) => message.error(error instanceof Error ? error.message : "更新失败"));
                        }}
                    />
                ),
            },
            {
                title: "操作",
                width: 88,
                render: (_, record) => (
                    <Button
                        type="link"
                        danger
                        onClick={() => {
                            modal.confirm({
                                title: "删除画廊条目",
                                content: `确定删除「${record.title}」？此操作不可恢复。`,
                                okText: "删除",
                                okButtonProps: { danger: true },
                                onOk: async () => {
                                    await deleteGalleryItem(record.id);
                                    message.success("已删除");
                                    void load();
                                },
                            });
                        }}
                    >
                        删除
                    </Button>
                ),
            },
        ],
        [message, modal],
    );

    return (
        <AdminDataTable
            toolbar={
                <Input
                    allowClear
                    prefix={<Search className="size-3.5" />}
                    placeholder="搜索标题或提示词"
                    value={keyword}
                    onChange={(event) => {
                        setKeyword(event.target.value);
                        setPage(1);
                    }}
                    style={{ width: 260 }}
                />
            }
            toolbarActive={hasFilters}
            toolbarFilters={
                <Select
                    value={mediaType}
                    onChange={(value) => {
                        setMediaType(value);
                        setPage(1);
                    }}
                    options={[
                        { label: "全部类型", value: "all" },
                        { label: "图片", value: "image" },
                        { label: "视频", value: "video" },
                    ]}
                    style={{ width: 140 }}
                />
            }
            trailing={
                <Upload
                    accept="application/json,.json"
                    showUploadList={false}
                    beforeUpload={(file) => {
                        setImporting(true);
                        void importGalleryItems(file)
                            .then((result) => {
                                message.success(`已导入 ${result.imported_count} 条`);
                                void load();
                            })
                            .catch((error) => message.error(error instanceof Error ? error.message : "导入失败"))
                            .finally(() => setImporting(false));
                        return false;
                    }}
                >
                    <Button icon={<UploadIcon className="size-4" />} loading={importing}>
                        导入 JSON
                    </Button>
                </Upload>
            }
            onReset={() => {
                setKeyword("");
                setMediaType("all");
                setPage(1);
            }}
            table={{
                rowKey: "id",
                loading,
                columns,
                dataSource: items,
                pagination: false,
            }}
            empty={<AdminTableEmpty filtered={hasFilters} title={hasFilters ? undefined : "暂无画廊条目"} description={hasFilters ? undefined : "可导入 prompts.json，或等待服务启动后自动灌入默认数据。"} />}
            footer={<PaginationBar alwaysShow current={page} pageSize={pageSize} total={total} onChange={(nextPage, nextSize) => {
                setPage(nextSize !== pageSize ? 1 : nextPage);
                setPageSize(nextSize);
            }} />}
        />
    );
}
