/** 界面文案字段（label、title、subtitle 等）保存 i18n 键，渲染时翻译；首幕标题是品牌名，直接显示。 */
export const chapters = [
    { id: "opening", label: "序幕", title: "Navo AI", subtitle: "让一个故事，从文字走向银幕。", description: "面向 AI 影视与短剧创作的开源工作台。" },
    { id: "story", label: "故事", title: "一念，成故事。" },
    { id: "world", label: "角色", title: "让想象，有了面孔。" },
    { id: "shots", label: "分镜", title: "字里行间，皆是镜头。" },
    { id: "motion", label: "生成", title: "这一刻，动起来。" },
    { id: "canvas", label: "画布", title: "一个世界，一张画布。" },
] as const;

export type WelcomeLook = {
    id: string;
    label: string;
    title: string;
    frames: string[];
    screenplay: string[];
    video?: string;
    credit?: string;
};

/** 剧本台词保存为 account.welcome.looks.<look>.screenplay.<n> 键，渲染时翻译。 */
const screenplayKeys = (look: string) => Array.from({ length: 12 }, (_, index) => `account.welcome.looks.${look}.screenplay.line${index + 1}`);
const reelFrames = (folder: string, names: string[]) => Array.from({ length: 12 }, (_, index) => `/welcome/${folder}/${names[index % names.length]}.webp`);

export const welcomeLooks: WelcomeLook[] = [
    {
        id: "spring", label: "account.welcome.looks.spring.label", title: "account.welcome.looks.spring.title",
        frames: reelFrames("spring", ["1807", "1669", "4336", "3191", "3250"]),
        screenplay: screenplayKeys("spring"),
        credit: "account.welcome.looks.spring.credit",
    },
    {
        id: "charge", label: "account.welcome.looks.charge.label", title: "account.welcome.looks.charge.title",
        frames: reelFrames("charge", ["factory-final", "einar", "robot", "character-final", "factory"]),
        screenplay: screenplayKeys("charge"),
        video: "/welcome/charge/sequence.mp4", credit: "account.welcome.looks.charge.credit",
    },
    {
        id: "wing-it", label: "account.welcome.looks.wingIt.label", title: "account.welcome.looks.wingIt.title",
        frames: reelFrames("wing-it", ["banner", "pitch", "sky-01", "barn", "sky-04", "sky-06"]),
        screenplay: screenplayKeys("wingIt"),
        credit: "account.welcome.looks.wingIt.credit",
    },
];

export function getWelcomeLook(search = window.location.search) {
    const id = new URLSearchParams(search).get("look");
    return welcomeLooks.find((look) => look.id === id) ?? welcomeLooks[0];
}

export const showcases = [
    { name: "account.welcome.showcases.canvas.name", image: "/welcome/workbench-canvas.webp", description: "account.welcome.showcases.canvas.description", detail: "account.welcome.showcases.canvas.detail", href: "/canvas" },
    { name: "account.welcome.showcases.create.name", image: "/welcome/workbench-create.webp", description: "account.welcome.showcases.create.description", detail: "account.welcome.showcases.create.detail", href: "/create" },
    { name: "account.welcome.showcases.projects.name", image: "/welcome/workbench-project.webp", description: "account.welcome.showcases.projects.description", detail: "account.welcome.showcases.projects.detail", href: "/projects" },
] as const;
