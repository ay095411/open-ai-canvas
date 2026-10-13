import { useEffect, useState } from "react";
import { Bot, Camera, Cat, CircleUserRound, Clapperboard, Rabbit, Rocket, Sparkles, type LucideIcon } from "lucide-react";

import { CoalAvatar } from "@/components/brand/coal-avatar";
import { cn } from "@/lib/utils";
import { isDefaultUserAvatarID, type DefaultUserAvatarID } from "@/lib/default-user-avatars";
import { resolveUserAvatarURL } from "@/lib/user-avatar-url";
import { apiBaseURL } from "@/services/api/request";
import type { LocalUser } from "@/stores/use-user-store";

const defaultAvatarIcons: Record<DefaultUserAvatarID, LucideIcon> = {
    person: CircleUserRound,
    director: Clapperboard,
    camera: Camera,
    cat: Cat,
    rabbit: Rabbit,
    robot: Bot,
    rocket: Rocket,
    sparkles: Sparkles,
};

export function UserAvatar({ user, className, iconClassName }: { user: LocalUser; className?: string; iconClassName?: string }) {
    const [failed, setFailed] = useState(false);
    const avatarUrl = user.avatarMode === "default" ? "" : resolveUserAvatarURL(user.avatarUrl, apiBaseURL);
    const DefaultAvatarIcon = defaultAvatarIcons[isDefaultUserAvatarID(user.avatarPreset) ? user.avatarPreset : "person"];

    useEffect(() => setFailed(false), [avatarUrl]);

    // 结构保持 span > svg：默认头像与真实头像共用同一个盒子，尺寸完全由 className 决定。
    // 显式选择预设头像时用所选图标；未配置或图片加载失败时落到品牌角色「黑煤球」——
    // 默认态也要有辨识度，人像图标谁都不是。
    return (
        <span className={cn("grid shrink-0 place-items-center overflow-hidden", className)}>
            {avatarUrl && !failed ? (
                <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setFailed(true)} />
            ) : user.avatarMode === "default" ? (
                <DefaultAvatarIcon className={cn("size-full", iconClassName)} aria-hidden />
            ) : (
                <CoalAvatar className="size-full" />
            )}
        </span>
    );
}
