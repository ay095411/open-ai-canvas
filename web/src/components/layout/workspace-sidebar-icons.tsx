import {
    Bot,
    Camera,
    Clock,
    Compass,
    Film,
    FolderHeart,
    Palette,
    Puzzle,
    Shapes,
    ToyBrick,
} from "lucide-react";

export type SidebarIconProps = { className?: string; strokeWidth?: number };

/** 创作（故事大纲、创意起笔）：圆润调色盘，卡通艺术 */
export const CreateNavIcon = Palette;

/** 灵感（灵感发现）：探索罗盘 */
export const InspirationNavIcon = Compass;

/** 创作影棚（图片/视频生成）：大眼萌相机，饱满圆润 */
export const ToolboxNavIcon = Camera;

/** 自由画布：几何图形三剑客（圆、方、三角），童趣画布 */
export const CanvasNavIcon = Shapes;

/** 短剧 Agent：圆角复古胶片卷轴，亲和影视感 */
export const ProjectNavIcon = Film;

/** 资产：带爱心的收藏文件夹，温度感素材库 */
export const AssetsNavIcon = FolderHeart;

/** 创作历史：圆圆的大钟表盘，温和回溯 */
export const HistoryNavIcon = Clock;

/** Skills：圆头圆脑大眼睛小机器人，软萌智能伙伴 */
export const SkillsNavIcon = Bot;

/** 插件：乐高玩具积木，童趣模块化扩展 */
export const PluginsNavIcon = ToyBrick;
