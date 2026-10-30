import { useRef } from "react";

import type { CreationMode } from "./creation-types";
import "./creation-showcase-band.css";

/**
 * 首页的作品带。
 *
 * 为什么需要它：未登录时 `CreationRecentProjects` 直接返回 null，首页只剩标题、输入框和
 * 一行 Agent 提示条，1600×1000 下下面 49% 是空的（实测数据见 `.workbuddy/memory/2026-10-30.md`）。
 *
 * 形态是**自动向左滚动的一整条**，不是可拖动的横向滚动区：
 * - 结构上把同一组卡片渲染两遍，轨道整体 `translateX(-50%)`，因为两段宽度完全相等，
 *   接缝处不会有跳帧（不会出现「滚到头再跳回开头」）。
 * - 视口 `overflow: hidden` + 两端渐隐遮罩，所以永远不出现横向滚动条。
 * - 鼠标移入 / 键盘聚焦 → `animation-play-state: paused`；移开继续，位置不重置。
 * - 卡片悬停时视频才 `play()`，`preload="none"` 不进首屏带宽。
 *
 * 它和「能力入口卡」不是一类东西：这里展示的是**输出效果** —— 每张封面都对应一条能直接
 * 粘进创作区跑出来的提示词，点一下就把提示词带回去，只写片名和题材。
 */

type ShowcaseEntry = {
    id: string;
    title: string;
    genre: string;
    mode: CreationMode;
    /** 封面；有视频时同时作为 `<video>` 的 poster。 */
    poster: string;
    /** 悬停才播放的示例片段。 */
    video?: string;
    /** 点卡片时带进创作区的提示词。 */
    prompt: string;
};

const SHOWCASE: ShowcaseEntry[] = [
    {
        id: "qipao",
        title: "雨巷旗袍",
        genre: "民国 · 年代",
        mode: "image",
        poster: "/showcase/qipao.webp",
        prompt: "中近景：民国时期雨后的青石板巷子，一位穿墨绿提花旗袍的年轻女人撑黑伞站立，侧身回望镜头。旗袍高领盘扣，发鬓盘起，耳坠是小只珍珠。伞沿的水滴成串落下，身后是湿漉漉的白墙黑瓦与一盏昏黄壁灯，雨水在青石板上积成倒影。冷调环境配暖色灯光，浅景深，胶片质感。",
    },
    {
        id: "neon-girl",
        title: "霓虹雨夜",
        genre: "都市 · 赛博",
        mode: "image",
        poster: "/showcase/neon-girl.webp",
        prompt: "中近景半身人像：雨夜霓虹街头，一位短发年轻女人靠在瓷砖墙边，转头看向镜头。穿黑色皮外套和高领毛衣。左半边脸被青色霓虹照亮，右半边是暖紫色招牌的反光，发梢湿了贴在脸侧。背景虚化的汉字招牌、雨水和水幕。冷紫主调，浅景深，脸要清楚。",
    },
    {
        id: "swordswoman",
        title: "竹林剑客",
        genre: "武侠 · 古装",
        mode: "image",
        poster: "/showcase/swordswoman.webp",
        prompt: "中近景：竹林中，一位年轻女剑客侧身站立，手执长剑垂在体侧，转头看向镜头。穿深青色窄袖劲装，长发用木簪束起，颊侧有一道浅疤。竹叶被风扰动，阳光从竹梢筛下来在她脸和肩头打成斑驳。背景是密集竹干与薄雾，地上有落叶。浅景深，冷绿调，武侠电影剧照。",
    },
    {
        id: "guqin",
        title: "月下抚琴",
        genre: "东方 · 古典",
        mode: "image",
        poster: "/showcase/guqin.webp",
        prompt: "中近景：夜晚的中式卧室，一位穿素白长衣的年轻女人坐在古琴前，手指按在弦上，侧脸低垂。窗外一轮清冷的月光从右后方打进来，把她的轮廓和琴身照出一条亮边，室内只有一盏烛火在桌面跳动。深色木质家具、纱帐、淡淡的烟。低饱和、冷暖对比，东方古典美学。",
    },
    {
        id: "desert-red",
        title: "风起沙丘",
        genre: "时尚 · 西部",
        mode: "image",
        poster: "/showcase/desert-red.webp",
        prompt: "中近景：黄昏的沙丘顶，一位年轻女人穿长红裙站立，风把裙摆和头发向一侧吹开，她一手压住帽檐，侧脸对着落日。沙面上有风纹和她身后的脚印，远处是层层叠叠的暖橙色沙丘。逆光，人物边缘发光，红裙在暖色沙上很跳。暖调、高对比、胶片质感。",
    },
    {
        id: "rooftop",
        title: "天台夜色",
        genre: "时尚 · 都市",
        mode: "image",
        poster: "/showcase/rooftop.webp",
        prompt: "中近景：城市天台的夜晚，一位年轻女人穿米色风衣，靠在水泥围栏边侧头看向远处的楼群灯光，风吹起她的头发。前景是虚化的绿色铁丝网，背景是颗粒感的城市夜景与零星亮窗。她的脸被一侧的广告牌霓虹打亮，轮廓清晰，其余部分沉入暗调。写实时尚摄影质感，浅景深。",
    },
    {
        id: "wheat-mecha",
        title: "麦田里的机甲",
        genre: "废土 · 奇幻",
        mode: "video",
        poster: "/showcase/wheat-mecha.webp",
        video: "/showcase/wheat-mecha.mp4",
        prompt: "黄昏的金色麦田，麦浪被风压出一道道弧线。画面中景：一台半跪着的锈蚀人形机甲，胸口装甲裂开，露出缠绕的线束。一个穿褪色棉裙的少女站在它膝前，踮脚用一块布擦掉装甲上的泥。光线从左后方压低射入，麦穗边缘发亮，机甲金属只反射出一线暖色。空气里有细小的浮尘。35mm 胶片质感，浅景深，颗粒克制。\n\n运镜：缓慢横移半米，从麦穗前景摇到人物侧面，最后停在机甲眼睛特写的前一帧。\n声音：麦浪摩擦声、远处金属热胀的咔哒声，无人声。",
    },
    {
        id: "snow-train",
        title: "雪原列车",
        genre: "年代 · 公路",
        mode: "video",
        poster: "/showcase/snow-train.webp",
        video: "/showcase/snow-train.mp4",
        prompt: "冬季雪原，一列老式绿皮火车在画面中横穿。远景：列车在纯白地平线上拉出一条深绿的长线，蒸汽和雪雾混在一起。切到车厢内中景：靠窗座位，窗外雪光把两个人的脸照得很白，一人坐在过道另一侧，正侧头看过来，视线在半空相遇。车窗玻璃上有手指擦过的雾痕。胶片颗粒，暖色车厢与冷色窗外对比。\n\n运镜：先航拍远景跟随列车横移，再硬切到车厢内固定机位，靠窗人的视线转向时轻微推近。\n声音：铁轨接缝的规律撞击、车厢连接处的金属摩擦、很轻的手风琴。",
    },
    {
        id: "ice-lake",
        title: "冰湖破晓",
        genre: "自然 · 诗意",
        mode: "image",
        poster: "/showcase/ice-lake.webp",
        prompt: "中近景：一个人跪在冰封湖面的冰上，手掌贴在冰面，掌心下的白色裂纹向四周发散。人物占据画面右侧三分之一，穿深色厚外套，呼出的白气很明显，脸被晨光照亮。背景虚化的冰面延伸到远处，天边是极浅的青灰到暖白。贴冰面的低机位，浅景深，冰层内部有气泡和幽蓝反光。电影剧照。",
    },
    {
        id: "hive-apartment",
        title: "蜂巢公寓",
        genre: "反乌托邦 · 科幻",
        mode: "image",
        poster: "/showcase/hive-apartment.webp",
        prompt: "中近景：从室内拍一个蜂巢集合住宅的六边形窗户，一个中年女人站在窗前向外看，窗帘半拉，室内只有一盏台灯。她的侧脸占画面左侧，窗外是密集重复的脏水泥六边形窗格，大部分是黑的，远处一两格亮着。玻璃上有手印和灰尘。压迫感、冷调室内与暗橙室外对比。电影剧照。",
    },
    {
        id: "ancestral-candles",
        title: "祠堂烛火",
        genre: "中式民俗 · 悬疑",
        mode: "image",
        poster: "/showcase/ancestral-candles.webp",
        prompt: "老祠堂内部，昏暗。画面正中是一张深色供桌，上面并排立着十几块牌位，字迹被烟熏得发暗。供桌前缘一排红烛，烛火被穿堂风吹得齐齐向左压。空气中有香灰的悬浮颗粒。唯独最里面那一支烛火笔直不动。右侧一根门柱切进画面，边缘一点冷蓝的天光。低饱和，暗部保留细节，不要恐怖跳吓风格。",
    },
    {
        id: "elevator-abyss",
        title: "深海电梯",
        genre: "科幻 · 惊悚",
        mode: "image",
        poster: "/showcase/elevator-abyss.webp",
        prompt: "中近景：深海里一双手紧紧抓着老旧铁栅电梯的门，指节泛白，门撬开一道缝，暖黄色灯光从缝里泄出来，照亮了手背上的水珠和周围的悬浮颗粒。背景是浑浊的墨绿水体与锈蚀铁架。灯光只照亮手和门缝周围一小块，其余全暗。水下摄影质感，可见悬浮物。",
    },
    {
        id: "pharmacy",
        title: "药房夜班",
        genre: "悬疑 · 都市",
        mode: "image",
        poster: "/showcase/pharmacy.webp",
        prompt: "中近景：深夜药店，店员的脸紧贴在玻璃柜台内侧，眼睛看着柜外，白色工作服。柜台玻璃上有一层手印和反光，映出身后空荡的货架。冷绿色主调，一道暖黄照明从上方打在他脸上，脸上有一半在阴影里。表情平静但不对劲。写实电影质感，浅景深。",
    },
    {
        id: "night-market",
        title: "夜市收摊",
        genre: "都市 · 生活流",
        mode: "image",
        poster: "/showcase/night-market.webp",
        prompt: "凌晨的街边夜市，摊主在收摊。近景：一双湿手把蓝白条纹塑料布从铁架上扯下来，布角挂着的水珠沿着褶皱往下滑。地上积水映着还没关的两盏灯，一盏偏暖一盏偏青。背景虚化的塑料凳和泡沫箱。空气潮湿，有薄雾。写实电影质感，冷调，高光不过曝。",
    },
];

export function CreationShowcaseBand({ onStartPrompt }: { onStartPrompt: (mode: CreationMode, prompt: string) => void }) {
    return (
        <section className="creation-showcase" aria-labelledby="creation-showcase-title">
            <header className="creation-showcase-head">
                <h2 id="creation-showcase-title">看看能拍成什么样</h2>
                <p>点一张把提示词带进创作区</p>
            </header>
            <div className="creation-showcase-viewport">
                <div className="creation-showcase-track">
                    <ShowcaseSet onStartPrompt={onStartPrompt} />
                    {/* 第二份只为了无缝衔接：不参与无障碍树，也不抢 Tab 焦点。 */}
                    <ShowcaseSet onStartPrompt={onStartPrompt} clone />
                </div>
            </div>
        </section>
    );
}

function ShowcaseSet({ onStartPrompt, clone = false }: { onStartPrompt: (mode: CreationMode, prompt: string) => void; clone?: boolean }) {
    return (
        <ul className="creation-showcase-set" aria-hidden={clone || undefined}>
            {SHOWCASE.map((entry) => <ShowcaseCard key={entry.id} entry={entry} clone={clone} onStart={() => onStartPrompt(entry.mode, entry.prompt)} />)}
        </ul>
    );
}

function ShowcaseCard({ entry, onStart, clone }: { entry: ShowcaseEntry; onStart: () => void; clone: boolean }) {
    const videoRef = useRef<HTMLVideoElement>(null);

    // 只在悬停 / 聚焦时播放：十几张卡同时解码会把首屏拖死，静音预览本来也只是「看一眼运镜」。
    const start = () => {
        const video = videoRef.current;
        if (!video) return;
        video.currentTime = 0;
        void video.play().catch(() => { /* 自动播放被拦时保持封面，不打扰用户 */ });
    };
    const stop = () => {
        const video = videoRef.current;
        if (!video) return;
        video.pause();
        video.currentTime = 0;
    };

    return (
        <li className="creation-showcase-item">
            <button
                type="button"
                className="creation-showcase-card"
                tabIndex={clone ? -1 : undefined}
                aria-label={`用「${entry.title}」的提示词开始创作`}
                onClick={onStart}
                onPointerEnter={start}
                onPointerLeave={stop}
                onFocus={start}
                onBlur={stop}
            >
                <span className="creation-showcase-cover">
                    {entry.video ? (
                        <video ref={videoRef} src={entry.video} poster={entry.poster} muted loop playsInline preload="none" aria-hidden="true" tabIndex={-1} />
                    ) : (
                        <img src={entry.poster} alt="" width={1280} height={720} loading="lazy" decoding="async" draggable={false} />
                    )}
                    {entry.video ? <span className="creation-showcase-badge">示例片段</span> : null}
                </span>
                <span className="creation-showcase-copy">
                    <strong>{entry.title}</strong>
                    <span>{entry.genre}</span>
                </span>
            </button>
        </li>
    );
}
