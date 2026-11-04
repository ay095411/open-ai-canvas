import { App, Button, InputNumber, Select, Spin } from "antd";
import { AdminModal } from "@/pages/admin/ui/overlays";
import { ArrowDown, ArrowUp, GripVertical, ListOrdered } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AdminEmpty } from "@/pages/admin/components/admin-ui";
import { getChannelOrder, saveChannelOrder, type ChannelOrderItem } from "@/services/api/channel-order";
import { modelProtocolLabel, type ModelProtocolDefinition } from "@/lib/model-protocols";
import "./channel-order-dialog.css";

const capabilityLabels = { text: "文本", image: "图片", video: "视频", audio: "音频", "": "能力未配置" };

function itemIdentity(item: ChannelOrderItem) {
    return item.modelKey ? `${item.name}（${item.modelKey}）` : item.name;
}

function OrderItemInfo({ item, model, protocols }: { item: ChannelOrderItem; model: boolean; protocols: ModelProtocolDefinition[] }) {
    return (
        <span className="admin-order-item-info">
            <span className="admin-order-item-heading">
                <strong>{item.name}</strong>
                {model && <span className="admin-order-capability">{capabilityLabels[item.capability || ""]}</span>}
                {!item.enabled && <span className="admin-order-disabled">已停用</span>}
            </span>
            {model && (
                <span className="admin-order-item-details">
                    <span>
                        <span className="admin-order-field-label">模型标识：</span>
                        <code>{item.modelKey || "未配置"}</code>
                    </span>
                    {item.channelLabel && (
                        <span>
                            <span className="admin-order-field-label">渠道展示名：</span>
                            {item.channelLabel}
                        </span>
                    )}
                    {item.providerModelKey && item.providerModelKey !== item.modelKey && (
                        <span>
                            <span className="admin-order-field-label">上游标识：</span>
                            <code>{item.providerModelKey}</code>
                        </span>
                    )}
                    <span>
                        <span className="admin-order-field-label">请求协议：</span>
                        {item.protocol ? modelProtocolLabel(item.protocol, protocols) : "未配置"}
                    </span>
                </span>
            )}
        </span>
    );
}

export function moveOrderItem<T extends { id: string }>(items: T[], id: string, target: number): T[] {
    const from = items.findIndex((item) => item.id === id);
    if (from < 0 || !Number.isInteger(target) || target < 0 || target >= items.length || from === target) return items;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(target, 0, item!);
    return next;
}

export function ChannelOrderDialog({ channelId, channelName, protocols = [], onSaved }: { channelId?: string; channelName?: string; protocols?: ModelProtocolDefinition[]; onSaved: () => Promise<void> }) {
    const { message } = App.useApp();
    const [open, setOpen] = useState(false),
        [loading, setLoading] = useState(false),
        [saving, setSaving] = useState(false);
    const [items, setItems] = useState<ChannelOrderItem[]>([]),
        [original, setOriginal] = useState<string[]>([]);
    const [targetId, setTargetId] = useState<string>();
    const [targetPosition, setTargetPosition] = useState<number | null>(null);
    const dragged = useRef<string | null>(null),
        pending = useRef(false);
    const rows = useRef(new Map<string, HTMLDivElement>());
    const isModelOrder = Boolean(channelId);
    const selectedIndex = items.findIndex((item) => item.id === targetId);
    const selectedItem = items[selectedIndex];
    const changed = items.some((item, index) => item.id !== original[index]);
    useEffect(() => {
        if (targetId) rows.current.get(targetId)?.scrollIntoView({ block: "nearest" });
    }, [targetId, items]);
    const selectItem = (id: string) => {
        setTargetId(id);
        setTargetPosition(items.findIndex((item) => item.id === id) + 1);
    };
    const move = (id: string, target: number) => {
        if (saving || !Number.isInteger(target) || target < 0 || target >= items.length) return;
        setItems((current) => moveOrderItem(current, id, target));
        setTargetId(id);
        setTargetPosition(target + 1);
    };
    const options = items.map((item, index) => ({
        value: item.id,
        label: `${index + 1}. ${itemIdentity(item)}${item.enabled ? "" : "（已停用）"}`,
        searchText: [item.name, item.modelKey, item.providerModelKey, item.channelLabel, capabilityLabels[item.capability || ""], item.protocol, modelProtocolLabel(item.protocol, protocols)].filter(Boolean).join(" "),
        item,
        position: index + 1,
    }));
    const start = async () => {
        setOpen(true);
        setLoading(true);
        setItems([]);
        setOriginal([]);
        setTargetId(undefined);
        setTargetPosition(null);
        try {
            const result = await getChannelOrder(channelId);
            setItems(result.items);
            setOriginal(result.items.map((item) => item.id));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取排序失败");
            setOpen(false);
        } finally {
            setLoading(false);
        }
    };
    const save = async () => {
        if (pending.current || !changed) return;
        pending.current = true;
        setSaving(true);
        try {
            await saveChannelOrder(
                channelId,
                items.map((item) => item.id),
                original,
            );
            setOpen(false);
            message.success("排序已保存，用户端按此顺序展示");
            try {
                await onSaved();
            } catch (error) {
                message.warning(error instanceof Error ? `排序已保存，但列表刷新失败：${error.message}` : "排序已保存，请刷新页面查看");
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存排序失败");
        } finally {
            pending.current = false;
            setSaving(false);
        }
    };
    return (
        <>
            <Button icon={<ListOrdered className="size-4" />} disabled={loading || saving} onClick={() => void start()}>
                {channelId ? "自定义排序" : "设置排序"}
            </Button>
            <AdminModal
                title={channelId ? "自定义模型排序" : "调整渠道顺序"}
                open={open}
                onCancel={() => setOpen(false)}
                closable={!saving && !loading}
                mask={{ closable: !saving && !loading }}
                keyboard={!saving && !loading}
                width={780}
                className="admin-order-dialog"
                footer={
                    <div className="flex justify-end gap-2">
                        <Button disabled={saving || loading} onClick={() => setOpen(false)}>
                            取消
                        </Button>
                        <Button type="primary" loading={saving} disabled={!changed || loading} onClick={() => void save()}>
                            保存排序
                        </Button>
                    </div>
                }
            >
                <div className="admin-order-context">
                    {isModelOrder && <strong>所属渠道：{channelName || channelId}</strong>}
                    {!loading && (
                        <span>
                            共 {items.length} 个{isModelOrder ? "模型" : "渠道"}，包含已停用项
                        </span>
                    )}
                </div>
                <p className="admin-order-hint">选择要调整的{isModelOrder ? "模型" : "渠道"}后输入目标位置，也可拖动或使用上下箭头。这里显示全部条目，不受列表筛选和分页影响；点击“保存排序”后生效。</p>
                <div className="admin-order-toolbar">
                    <Select
                        className="admin-order-picker"
                        aria-label={channelId ? "选择要排序的模型" : "选择要排序的渠道"}
                        placeholder={channelId ? "搜索模型名称、模型标识或上游标识" : "搜索并选择渠道"}
                        showSearch={{ optionFilterProp: "searchText" }}
                        value={targetId}
                        disabled={loading || saving || !items.length}
                        options={options}
                        virtual={false}
                        classNames={{ popup: { root: "admin-order-options" } }}
                        optionRender={({ data }) => (
                            <div className="admin-order-option">
                                <span className="admin-order-position">{data.position}</span>
                                <OrderItemInfo item={data.item} model={isModelOrder} protocols={protocols} />
                            </div>
                        )}
                        onChange={selectItem}
                    />
                    <InputNumber aria-label="目标位置" placeholder="位置" min={1} max={items.length || 1} precision={0} value={targetPosition} disabled={loading || saving || !targetId} onChange={setTargetPosition} />
                    <Button
                        disabled={loading || saving || !targetId || targetPosition === null || !Number.isInteger(targetPosition) || targetPosition < 1 || targetPosition > items.length}
                        onClick={() => {
                            if (targetId && targetPosition !== null) move(targetId, targetPosition - 1);
                        }}
                    >
                        移动到此位置
                    </Button>
                </div>
                {selectedItem ? (
                    <div className="admin-order-selection" role="status">
                        <div className="admin-order-selection-heading">
                            <strong>当前选中{isModelOrder ? "模型" : "渠道"}</strong>
                            <span>
                                第 {selectedIndex + 1} 位 / 共 {items.length} 项
                            </span>
                        </div>
                        <OrderItemInfo item={selectedItem} model={isModelOrder} protocols={protocols} />
                    </div>
                ) : (
                    <p className="admin-order-selection-hint">点击下方条目或使用搜索选择，选中后会高亮显示。</p>
                )}
                <Spin spinning={loading}>
                    <div className="admin-order-list" role="list" aria-label="展示顺序">
                        {!loading && !items.length ? (
                            <AdminEmpty size="compact" title="暂无可排序条目" />
                        ) : (
                            items.map((item, index) => (
                                <div
                                    role="listitem"
                                    key={item.id}
                                    data-order-id={item.id}
                                    ref={(element) => {
                                        if (element) rows.current.set(item.id, element);
                                        else rows.current.delete(item.id);
                                    }}
                                    draggable={!saving}
                                    onDragStart={(event) => {
                                        event.dataTransfer.setData("text/plain", item.id);
                                        dragged.current = item.id;
                                        selectItem(item.id);
                                    }}
                                    onDragEnd={() => {
                                        dragged.current = null;
                                    }}
                                    onDragOver={(event) => {
                                        if (!saving) event.preventDefault();
                                    }}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        const source = dragged.current;
                                        if (!saving && source) move(source, index);
                                        dragged.current = null;
                                    }}
                                    className={`admin-order-row${targetId === item.id ? " is-selected" : ""}`}
                                >
                                    <GripVertical aria-hidden className="admin-order-grip size-4" />
                                    <span className="admin-order-position">{index + 1}</span>
                                    <button
                                        type="button"
                                        className="admin-order-select-item"
                                        aria-label={`选择${isModelOrder ? "模型" : "渠道"}${itemIdentity(item)}`}
                                        aria-pressed={targetId === item.id}
                                        disabled={saving}
                                        onClick={() => selectItem(item.id)}
                                    >
                                        <OrderItemInfo item={item} model={isModelOrder} protocols={protocols} />
                                        {targetId === item.id && <span className="admin-order-selected-label">当前选中</span>}
                                    </button>
                                    <Button aria-label={`上移${itemIdentity(item)}`} title="上移" icon={<ArrowUp className="size-4" />} disabled={saving || index === 0} onClick={() => move(item.id, index - 1)} />
                                    <Button aria-label={`下移${itemIdentity(item)}`} title="下移" icon={<ArrowDown className="size-4" />} disabled={saving || index === items.length - 1} onClick={() => move(item.id, index + 1)} />
                                </div>
                            ))
                        )}
                    </div>
                </Spin>
            </AdminModal>
        </>
    );
}
