import { Alert, Button, Input } from "antd";
import { useEffect, useRef, useState } from "react";

import type { LibraryCandidate } from "@/services/api/inspiration-library-admin";
import { AdminModal } from "../ui/overlays";
import { emptyLibraryCandidate, LIBRARY_IMPORT_MAX_BYTES, parseLibraryCandidateJson } from "./candidate-import";

export function LibraryImportModal({ working, error, notice, onClose, onImport }: { working: boolean; error: string; notice: string; onClose: () => void; onImport: (items: LibraryCandidate[]) => Promise<void> }) {
    const [text, setText] = useState("");
    const [localError, setLocalError] = useState("");
    const [reading, setReading] = useState(false);
    const readVersion = useRef(0);
    useEffect(
        () => () => {
            readVersion.current += 1;
        },
        [],
    );
    const loadFile = async (file?: File) => {
        if (!file) return;
        const version = ++readVersion.current;
        setLocalError("");
        if (file.size > LIBRARY_IMPORT_MAX_BYTES) {
            setLocalError("文件超过 2 MiB，请拆分导入");
            return;
        }
        setReading(true);
        try {
            const content = await file.text();
            if (version === readVersion.current) setText(content);
        } catch (cause) {
            if (version === readVersion.current) setLocalError(cause instanceof Error ? cause.message : "文件读取失败");
        } finally {
            if (version === readVersion.current) setReading(false);
        }
    };
    const submit = async () => {
        if (working || reading) return;
        setLocalError("");
        try {
            await onImport(parseLibraryCandidateJson(text));
        } catch (cause) {
            setLocalError(cause instanceof Error ? cause.message : "候选导入失败");
        }
    };
    return (
        <AdminModal
            open
            title="导入待审核候选"
            onCancel={onClose}
            closable={!working && !reading}
            keyboard={!working && !reading}
            mask={{ closable: !working && !reading }}
            footer={
                <>
                    <Button disabled={working || reading} onClick={onClose}>
                        关闭
                    </Button>
                    <Button type="primary" loading={working} disabled={working || reading || !text.trim()} onClick={() => void submit()}>
                        导入待审核候选
                    </Button>
                </>
            }
        >
            <div className="inspiration-library-import">
                <Alert type="warning" title="导入不等于批准，也不是许可证明" description="请由管理员填写真实权利人、许可地址、授权证据及必要署名。后台不会抓取外站或自动批准；媒体必须是已上传的本地 ready 资源 resource:<id>。" />
                <p className="inspiration-library-note">每批最多 100 条、2 MiB。已有内容/授权更新会重新待审并退出白名单；相同内容不会重置批准。填空模板所有权利勾选均为 false，不含假造许可。</p>
                <div className="inspiration-library-import-actions">
                    <Button
                        disabled={working || reading}
                        onClick={() => {
                            setText(JSON.stringify({ items: [emptyLibraryCandidate()] }, null, 2));
                            setLocalError("");
                        }}
                    >
                        使用填空模板
                    </Button>
                    <label className="inspiration-library-file">
                        读取本地 JSON
                        <input
                            type="file"
                            aria-label="读取候选 JSON 文件"
                            accept=".json,application/json"
                            disabled={working || reading}
                            onChange={(event) => {
                                void loadFile(event.target.files?.[0]);
                                event.target.value = "";
                            }}
                        />
                    </label>
                </div>
                <Input.TextArea aria-label="候选 JSON" value={text} rows={15} disabled={working || reading} onChange={(event) => setText(event.target.value)} placeholder={'{"items": [ ...填写完成的候选... ]}'} />
                {reading ? <p role="status">正在读取本地 JSON…</p> : null}
                {localError || error ? <Alert type="error" title={localError || error} /> : null}
                {notice ? <Alert type="success" title={notice} /> : null}
            </div>
        </AdminModal>
    );
}
