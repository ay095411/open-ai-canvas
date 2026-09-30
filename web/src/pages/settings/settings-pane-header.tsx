/**
 * 分区标题的统一写法。单独成文件是因为 `settings-workbench` 与各个分区互相引用，
 * 把标题块放进 workbench 会形成 import 环。
 *
 * 之前各分区各自为政：「问题诊断」自己写了一份 text-2xl 的大标题 + 装饰性 kicker，
 * 「我的对象存储」干脆没有标题，其余分区用 `.settings-pane-header`。统一之后
 * 所有分区都走这一个块，宽度与标题层级也因此一致。
 */
export function SettingsPaneHeader({
    title,
    description,
    className = "",
}: {
    title: string;
    description: string;
    /** 分区是 `min-h-full` / `h-full` 的 flex 列时，标题需要 `shrink-0` 才不会被压扁。 */
    className?: string;
}) {
    return (
        <div className={`settings-pane-header ${className}`.trim()}>
            <div className="min-w-0">
                <h2>{title}</h2>
                <p>{description}</p>
            </div>
        </div>
    );
}
