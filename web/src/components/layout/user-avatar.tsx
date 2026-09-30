import { useEffect, useState } from "react";

import { CoalAvatar } from "@/components/brand/coal-avatar";
import { cn } from "@/lib/utils";
import type { LocalUser } from "@/stores/use-user-store";

export function UserAvatar({ user, className }: { user: LocalUser; className?: string }) {
    const [failed, setFailed] = useState(false);
    const avatarUrl = /^https?:\/\//i.test(user.avatarUrl || "") ? user.avatarUrl : "";

    useEffect(() => setFailed(false), [avatarUrl]);

    // 结构保持 span > svg：默认头像与真实头像共用同一个盒子，尺寸完全由 className 决定。
    // 未设置头像或图片加载失败时落到品牌角色「黑煤球」，不再用通用人像图标 ——
    // 默认态也要有辨识度，人像图标谁都不是。
    return (
        <span className={cn("grid shrink-0 place-items-center overflow-hidden", className)}>
            {avatarUrl && !failed ? (
                <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setFailed(true)} />
            ) : (
                <CoalAvatar className="size-full" />
            )}
        </span>
    );
}
