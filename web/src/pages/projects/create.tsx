import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input, InputNumber, Select } from "antd";
import { AlertTriangle, ArrowLeft, ArrowRight, ArrowUpRight, BookOpenText, Check, Clapperboard, ClipboardPaste, Cpu, FileUp, PencilLine, Play } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { DEFAULT_DRAMA_STYLE_ID, findDramaStyle, type DramaStyle } from "@/lib/drama/drama-styles";
import { decodeNovelText } from "@/lib/canvas/canvas-document";
import { analyzeNovel, EPISODE_GROUP_CHARS, EPISODE_SOURCE_CHARS, sourceChars, titleFromFileName } from "@/lib/drama/novel-parse";
import { ApiError } from "@/services/api/request";
import { linkCanvasToDrama } from "@/services/drama-canvas";
import { dramaChoiceKey, dramaVideoOptionFits, dramaVideoRatioIssue, dramaVideoResolutionIssue } from "@/lib/drama/model-choice";
import { DEFAULT_STORYBOARD } from "@/lib/drama/storyboard";
import {
    createDrama,
    deleteDrama,
    estimateDrama,
    listDramas,
    type DramaAssetSettings,
    type DramaCapability,
    type DramaEpisodeMode,
    type DramaListItem,
    type DramaMediaMode,
    type DramaModels,
    type DramaReviewMode,
    type DramaSkillRef,
    type DramaSourceFormat,
    type DramaStoryboardSettings,
    type DramaVideoContinuity,
} from "@/services/api/drama";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/stores/use-user-store";
import { RelativeTime } from "@/components/ui/product/relative-time";
import { progressFillStyle } from "@/lib/progress-fill";

import { EpisodeGroupField, formatCount, formatCredits, MEDIA_MODE_LABEL, MediaThumb, SOURCE_FORMAT_LABEL, SourceFormatPicker, STATUS_LABEL, VIDEO_CONTINUITY_LABEL } from "./drama-shared";
import { AssetSchemePicker, defaultAssetSettings, useAssetSchemes } from "./asset-scheme";
import { DramaModelPicker, useDramaModelCatalog } from "./drama-model-picker";
import { DramaAssetImageModels, DramaTextSteps, VideoResolutionField } from "./step-settings";
import { EpisodeDurationInput, StoryboardRules } from "./storyboard-rules";
import { DramaStylePicker } from "./style-picker";
import "./drama.css";

const MAX_FILE_BYTES = 40 * 1024 * 1024;

/** 从画布“交给短剧自动制作”带来的预填内容；canvasId 是创建后要关联的原画布（已关联项目的画布不带）。 */
type DramaCreatePrefill = { name?: string; sourceFormat?: DramaSourceFormat; text: string; canvasId?: string };
const RATIOS = [
    { value: "9:16", label: "竖屏 9:16", w: 9, h: 16 },
    { value: "16:9", label: "横屏 16:9", w: 16, h: 9 },
    { value: "1:1", label: "方形 1:1", w: 12, h: 12 },
];
const LANGUAGES = ["中文普通话", "粤语", "英语", "日语"];
const REVIEW_MODES: Array<{ value: DramaReviewMode; title: string; detail: string }> = [
    { value: "sample", title: "先看样片，满意后全剧自动", detail: "先做完第 1 集成片，请你确认一次画风、角色和声线，之后所有集自动跑到成片。" },
    { value: "every", title: "每集确认提示词", detail: "每集生成视频前停下来，等你审阅各剧情段的视频提示词与参考图。" },
    { value: "auto", title: "全自动", detail: "不打断，直接从小说跑到成片，可随时在制作台修改重做。" },
];
const CAPABILITY_LABEL: Record<DramaCapability, string> = { text: "默认文本", image: "默认图片", video: "剧情段视频" };
const EPISODE_MODES: Array<{ value: DramaEpisodeMode; title: string; detail: string }> = [
    { value: "chapter", title: "按章分集", detail: "按章节顺序固定分集，默认每章一集，也可以每 2–12 章合成一集；可以只放第 1 集，之后在制作台追加。单章不超过 1.2 万字。" },
    { value: "auto", title: "整本导入，自动分集", detail: "由模型按剧情把章节规划成集（可合并或拆分章节），适合一次导入整本小说；章节多时耗时更长。" },
];

/** 按章分集时的章节分组预览，与服务端 groupDramaChapterEpisodes 一致。 */
function groupChapters(chapters: Array<{ text: string }>, size: number) {
    const groups: Array<{ label: string; chars: number }> = [];
    for (let start = 0; start < chapters.length; start += size) {
        const end = Math.min(start + size, chapters.length);
        const chars = chapters.slice(start, end).reduce((sum, chapter) => sum + sourceChars(chapter.text), 0);
        groups.push({ label: end - start > 1 ? `第 ${start + 1}–${end} 章` : `第 ${start + 1} 章`, chars });
    }
    return groups;
}

const QUICK_GENRES = [
    { label: "都市商战", text: "退役隐姓兵王重返商界，开局遭未婚妻羞辱退婚，暗中调动千亿资本逆风翻盘。" },
    { label: "古风玄幻", text: "废柴宗门弟子觉醒上古神骨，各路仙尊前来跪求拜师，一剑断乾坤。" },
    { label: "悬疑反转", text: "密闭公馆的暴风雨之夜，连环意外背后藏着二十年前未曾公开的旧案。" },
    { label: "豪门争锋", text: "真假千金错换十八年，归来之日凭硬核实力夺回家族核心控股权。" },
];

export default function DramaCreatePage() {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const [pasteMode, setPasteMode] = useState(searchParams.get("paste") === "1");
    const [pasteText, setPasteText] = useState("");
    const [quickIdea, setQuickIdea] = useState("");
    /** 立项台双 Tab：一句话立项 / 导入剧本。 */
    const [hubTab, setHubTab] = useState<"idea" | "import">("idea");
    /** 「我的短剧作品」管理模式：卡片勾选，底部浮条批量删除（对齐 pavo 的 管理/完成 + 删除条）。 */
    const [managing, setManaging] = useState(false);
    const [selectedDramas, setSelectedDramas] = useState<string[]>([]);
    const [sourceText, setSourceText] = useState("");
    const [sourceFormat, setSourceFormat] = useState<DramaSourceFormat>("novel");
    // 默认逐集：一次只让流水线处理一集，长篇整本导入容易让改编任务超时。
    const [chapterMode, setChapterMode] = useState<DramaEpisodeMode>("chapter");
    const [groupSize, setGroupSize] = useState(1);
    const episodeMode: DramaEpisodeMode = sourceFormat === "novel" ? chapterMode : "chapter";
    const perEpisode = episodeMode === "chapter";
    // 剧本与分镜每个标题就是一集；小说按章分集时可每 N 章合成一集。
    const chaptersPerEpisode = sourceFormat === "novel" && perEpisode ? groupSize : 1;
    const analysis = useMemo(() => (sourceText ? analyzeNovel(sourceText, { perEpisode }) : null), [perEpisode, sourceText]);
    const episodeGroups = useMemo(() => (analysis && perEpisode ? groupChapters(analysis.chapters, chaptersPerEpisode) : []), [analysis, chaptersPerEpisode, perEpisode]);
    const oversizedGroup = episodeGroups.find((group) => group.chars > EPISODE_GROUP_CHARS);
    const [name, setName] = useState("");
    const [aspectRatio, setAspectRatio] = useState("9:16");
    const [episodeSeconds, setEpisodeSeconds] = useState(90);
    const [styleId, setStyleId] = useState(DEFAULT_DRAMA_STYLE_ID);
    const [language, setLanguage] = useState(LANGUAGES[0]);
    const [reviewMode, setReviewMode] = useState<DramaReviewMode>("sample");
    // 默认先只跑文本：先看剧情、镜头、设定和段提示词对不对，再决定花钱生成参考图与视频。
    const [mediaMode, setMediaMode] = useState<DramaMediaMode>("manual");
    const [videoContinuity, setVideoContinuity] = useState<DramaVideoContinuity>("tail_frame");
    const [storyboard, setStoryboard] = useState<DramaStoryboardSettings>(DEFAULT_STORYBOARD);
    const [promptSkill, setPromptSkill] = useState<DramaSkillRef>();
    const [bibleSkill, setBibleSkill] = useState<DramaSkillRef>();
    const [scriptSkill, setScriptSkill] = useState<DramaSkillRef>();
    const [videoResolution, setVideoResolution] = useState<string>();
    const [models, setModels] = useState<Partial<DramaModels>>({});
    const [budgetCredits, setBudgetCredits] = useState<number | null>(null);
    const assetCatalog = useAssetSchemes();
    const [assetDraft, setAssetDraft] = useState<DramaAssetSettings>();
    const assets = assetDraft || defaultAssetSettings(assetCatalog.data);
    const [previewIndex, setPreviewIndex] = useState(0);
    /** 粘贴页的实时解析结果；防抖 280ms，避免大段正文每敲一个字都跑一遍全文正则。 */
    const [pasteStats, setPasteStats] = useState<{ words: number; sections: number } | null>(null);
    useEffect(() => {
        const text = pasteText.trim();
        if (!text) {
            setPasteStats(null);
            return;
        }
        const timer = window.setTimeout(() => {
            const result = analyzeNovel(text, { perEpisode: sourceFormat === "novel" });
            setPasteStats({ words: result.words, sections: result.chapters.length });
        }, 280);
        return () => window.clearTimeout(timer);
    }, [pasteText, sourceFormat]);

    const style = findDramaStyle(styleId);
    const catalogQuery = useDramaModelCatalog();

    const user = useUserStore((state) => state.user);
    const existingDramasQuery = useQuery({
        queryKey: ["my-dramas-recent", user?.id],
        queryFn: ({ signal }) => listDramas({ page: 1, pageSize: 6 }, signal),
        enabled: Boolean(user),
    });
    const existingDramas = existingDramasQuery.data?.items || [];
    const queryClient = useQueryClient();
    const { modal } = App.useApp();
    const deleteDramasMutation = useMutation({
        mutationFn: async (ids: string[]) => {
            await Promise.all(ids.map((id) => deleteDrama(id)));
            return ids.length;
        },
        onSuccess: (count) => {
            void queryClient.invalidateQueries({ queryKey: ["my-dramas-recent"] });
            message.success(count === 1 ? "已删除 1 部短剧" : `已删除 ${count} 部短剧`);
            setSelectedDramas([]);
            setManaging(false);
        },
        onError: (error) => message.error(error instanceof ApiError || error instanceof Error ? error.message : "删除失败"),
    });
    const toggleDramaSelected = (projectId: string) => {
        setSelectedDramas((current) => (current.includes(projectId) ? current.filter((id) => id !== projectId) : [...current, projectId]));
    };
    const confirmDeleteSelected = () => {
        const count = selectedDramas.length;
        modal.confirm({
            title: count === 1 ? "删除这 1 部短剧？" : `删除这 ${count} 部短剧？`,
            content: "删除后该剧的所有章节、角色与成片都会一并移除，无法恢复。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => deleteDramasMutation.mutateAsync(selectedDramas),
        });
    };
    const resolvedModels = useMemo<DramaModels | undefined>(() => {
        const catalog = catalogQuery.data;
        if (!catalog) return undefined;
        const { defaults } = catalog;
        // 没手动选视频模型时按当前画幅与衔接方式挑：目录默认值给不出就换第一个给得出的，都不行留空并说明原因。
        const videoOptions = catalog.options.video || [];
        const fitting = videoOptions.filter((option) => dramaVideoOptionFits(option, aspectRatio, videoContinuity, videoResolution));
        const video = models.video || fitting.find((option) => dramaChoiceKey(option.choice) === dramaChoiceKey(defaults.video))?.choice || fitting[0]?.choice || {};
        return { ...models, text: models.text || defaults.text, image: models.image || defaults.image, video };
    }, [aspectRatio, catalogQuery.data, models, videoContinuity, videoResolution]);
    const videoOption = catalogQuery.data?.options.video?.find((option) => dramaChoiceKey(option.choice) === dramaChoiceKey(resolvedModels?.video));
    // 角色参考图用单独指定的模型，没有就用默认图片模型；参考图方案按它检查角色画幅。
    const characterImage = dramaChoiceKey(resolvedModels?.characterImage) ? resolvedModels?.characterImage : resolvedModels?.image;
    const imageOption = catalogQuery.data?.options.image?.find((option) => dramaChoiceKey(option.choice) === dramaChoiceKey(characterImage));
    const videoResolutionProblem = dramaVideoResolutionIssue(videoOption, videoResolution);
    const missingCapabilities = (Object.keys(CAPABILITY_LABEL) as DramaCapability[]).filter((capability) => catalogQuery.data && !dramaChoiceKey(resolvedModels?.[capability]));
    // 目录里有视频模型、但没有一个能按当前画幅与衔接方式出片：说清原因，不笼统说“没有可用模型”。
    const noFittingVideo = missingCapabilities.includes("video") && Boolean(catalogQuery.data?.options.video?.length);
    const unavailableCapabilities = missingCapabilities.filter((capability) => !(capability === "video" && noFittingVideo));
    const videoRatioProblem = dramaVideoRatioIssue(videoOption, aspectRatio);
    // 服务端只在支持图生视频时下发 tailFrameChain，缺省即不支持。
    const tailFrameProblem = videoContinuity === "tail_frame" && Boolean(videoOption) && !videoOption?.tailFrameChain;
    const settings = {
        aspectRatio,
        episodeSeconds,
        stylePrompt: style?.prompt || "",
        styleName: style?.name || "",
        language,
        reviewMode,
        mediaMode,
        videoContinuity,
        storyboard,
        ...(promptSkill ? { promptSkill } : {}),
        ...(bibleSkill ? { bibleSkill } : {}),
        ...(scriptSkill ? { scriptSkill } : {}),
        ...(videoResolution ? { videoResolution } : {}),
        concurrency: 4,
        models: resolvedModels,
        episodeMode,
        chaptersPerEpisode,
        ...(assets ? { assets } : {}),
    };
    const estimateQuery = useQuery({
        queryKey: [
            "drama-estimate",
            analysis?.chapters.length,
            analysis?.words,
            episodeMode,
            chaptersPerEpisode,
            episodeSeconds,
            aspectRatio,
            videoContinuity,
            JSON.stringify(storyboard),
            [assets?.resolution, assets?.propResolution, assets?.sceneResolution, assets?.characterRatio].join("|"),
            videoResolution || "",
            JSON.stringify(resolvedModels || {}),
        ],
        queryFn: ({ signal }) => estimateDrama({ chapterCount: analysis!.chapters.length, wordCount: analysis!.words, settings, episodeMode }, signal),
        enabled: Boolean(analysis && resolvedModels),
        staleTime: 30_000,
    });
    const estimate = estimateQuery.data;
    useEffect(() => {
        if (estimate && budgetCredits === null && estimate.maxMicrocredits > 0) setBudgetCredits(Math.ceil(estimate.maxMicrocredits / 1_000_000));
    }, [estimate, budgetCredits]);

    const loadText = (text: string, fileName?: string) => {
        const result = analyzeNovel(text, { perEpisode });
        if (!result.chapters.length) {
            message.error("没有读取到正文，请检查文件内容");
            return;
        }
        setSourceText(text);
        setBudgetCredits(null);
        if (fileName && !name) setName(titleFromFileName(fileName));
        if (!fileName && !name) setName(result.chapters[0]?.title.slice(0, 20) || "未命名短剧");
    };
    const loadFile = async (file: File) => {
        if (!/\.(txt|md|markdown)$/i.test(file.name)) {
            message.warning("目前支持 TXT 与 Markdown 文件");
            return;
        }
        if (file.size > MAX_FILE_BYTES) {
            message.warning("文件超过 40MB，请拆分后上传");
            return;
        }
        loadText(decodeNovelText(await file.arrayBuffer()), file.name);
    };
    const routeState = location.state as { file?: File; prefill?: DramaCreatePrefill } | null;
    const handedFile = routeState?.file;
    const prefill = routeState?.prefill;
    const handedRef = useRef(false);
    // 画布分镜带过来的原画布：作品创建后关联过去，成为它的精修画布。
    const linkCanvasRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (handedRef.current || (!handedFile && !prefill?.text)) return;
        handedRef.current = true;
        if (handedFile) void loadFile(handedFile);
        else if (prefill) {
            if (prefill.sourceFormat) setSourceFormat(prefill.sourceFormat);
            loadText(prefill.text);
            // loadText 在没有名称时会取首章标题，这里在它之后设置，以画布带来的名称为准。
            if (prefill.name?.trim()) setName(prefill.name.trim().slice(0, 80));
            linkCanvasRef.current = prefill.canvasId;
        }
        // 文件与预填内容只用于首次进入，清掉路由状态避免刷新或返回时重复解析。
        navigate(".", { replace: true, state: null });
    }, [handedFile, prefill]); // eslint-disable-line react-hooks/exhaustive-deps

    const initialIdea = searchParams.get("idea") || "";
    const ideaHandledRef = useRef(false);
    useEffect(() => {
        if (!initialIdea || ideaHandledRef.current || handedRef.current) return;
        ideaHandledRef.current = true;
        const ideaTitle = initialIdea.slice(0, 16);
        const storyText = `第一章：初露风芒\n${initialIdea}\n\n第二章：逆风破局\n对立激化，主角绝地突围，展现关键抉择。\n\n第三章：终局定音\n局势扭转，高潮反转收尾。`;
        setSourceFormat("novel");
        loadText(storyText, `${ideaTitle}.txt`);
        setName(ideaTitle);
    }, [initialIdea]); // eslint-disable-line react-hooks/exhaustive-deps
    const onDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setDragOver(false);
        const file = event.dataTransfer.files?.[0];
        if (file) void loadFile(file);
    };

    const create = useMutation({
        mutationFn: () =>
            createDrama({
                name: name.trim(),
                chapters: analysis!.chapters.map((chapter) => ({ title: chapter.title, text: chapter.text })),
                settings: { ...settings, models: resolvedModels },
                budgetMicrocredits: Math.max(0, Math.round((budgetCredits || 0) * 1_000_000)),
                start: true,
                sourceFormat,
                episodeMode,
            }),
        onSuccess: async (summary) => {
            const canvasId = linkCanvasRef.current;
            if (canvasId) {
                const { warning } = await linkCanvasToDrama(canvasId, summary.project.id);
                if (warning) message.warning(warning);
            }
            navigate(`/projects/${summary.project.id}`, { replace: true });
        },
        onError: (error) => message.error(error instanceof ApiError || error instanceof Error ? error.message : "创建失败"),
    });
    const tooLong = Boolean(analysis?.issues.some((issue) => issue.kind === "too_long")) || Boolean(oversizedGroup);
    const canStart = Boolean(analysis && name.trim() && resolvedModels && missingCapabilities.length === 0 && !videoRatioProblem && !videoResolutionProblem && !tailFrameProblem && !tooLong && !create.isPending);
    const unitLabel = perEpisode && chaptersPerEpisode === 1 ? "集" : "章";

    const previewChapter = analysis?.chapters[previewIndex];
    const handleQuickStart = () => {
        const ideaText = quickIdea.trim();
        if (!ideaText) return;
        const ideaTitle = ideaText.slice(0, 16);
        const storyText = `第一章：初露风芒\n${ideaText}\n\n第二章：逆风破局\n对立激化，主角绝地突围，展现关键抉择。\n\n第三章：终局定音\n局势扭转，高潮反转收尾。`;
        setSourceFormat("novel");
        linkCanvasRef.current = undefined;
        loadText(storyText, `${ideaTitle}.txt`);
        setName(ideaTitle);
    };

    const reset = () => {
        linkCanvasRef.current = undefined;
        setSourceText("");
        setPasteText("");
        setQuickIdea("");
        setName("");
        setPreviewIndex(0);
    };

    if (!analysis) {
        return (
            // drama-hub-stage：夜间把这条 main 的不透明底色放开，让舞台层的 ShapeGrid 网格透出来（见 drama.css）。
            <WorkspacePage fluid scroll={false} className="drama-hub-stage">
                <div
                    className={cn("drama-root drama-compose-empty flex h-full min-h-0 flex-col", pasteMode && "is-paste")}
                    onDragOver={(event) => {
                        if (event.dataTransfer.types.includes("Files")) {
                            event.preventDefault();
                            setDragOver(true);
                        }
                    }}
                    onDragLeave={(event) => {
                        if (event.currentTarget === event.target) setDragOver(false);
                    }}
                    onDrop={onDrop}
                >
                    {/* 全屏文件拖入响应浮层 */}
                    {dragOver ? (
                        <div className="drama-fullscreen-dropzone" aria-hidden="true">
                            <div className="drama-fullscreen-dropzone-icon">
                                <FileUp />
                            </div>
                            <strong>松开即可开始解析{SOURCE_FORMAT_LABEL[sourceFormat].title}</strong>
                            <p>支持 TXT 或 Markdown，自动识别编码与章节标题</p>
                        </div>
                    ) : null}

                    {pasteMode ? (
                        <div className="drama-paste">
                            <header className="drama-paste-head">
                                <div className="drama-paste-heading">
                                    <h2>粘贴{SOURCE_FORMAT_LABEL[sourceFormat].title}</h2>
                                    <p>整段贴进来就行：章节标题、平台插入语和分集都会自动处理。</p>
                                </div>
                            </header>

                            <div className="drama-paste-desk">
                                <div className="drama-paste-editor">
                                    <div className="drama-paste-editor-bar">
                                        <span className="drama-paste-editor-title">正文</span>
                                        <span className="drama-paste-editor-stats" aria-live="polite">
                                            {pasteStats ? (
                                                <>
                                                    <b>{formatCount(pasteStats.words)}</b> 字 · 识别到 <b>{pasteStats.sections}</b> {sourceFormat === "novel" ? "章" : "集"}
                                                </>
                                            ) : (
                                                "等待正文"
                                            )}
                                        </span>
                                    </div>
                                    <Input.TextArea
                                        autoFocus
                                        value={pasteText}
                                        onChange={(event) => setPasteText(event.target.value)}
                                        placeholder={SOURCE_FORMAT_LABEL[sourceFormat].placeholder}
                                        className="drama-paste-textarea"
                                    />
                                </div>

                                <aside className="drama-paste-aside">
                                    <div className="drama-paste-aside-block">
                                        <span className="drama-paste-aside-label">内容类型</span>
                                        <SourceFormatPicker value={sourceFormat} onChange={setSourceFormat} />
                                    </div>
                                    <div className="drama-paste-aside-block">
                                        <span className="drama-paste-aside-label">
                                            <BookOpenText aria-hidden="true" />
                                            写作规范
                                        </span>
                                        <ul className="drama-paste-guide">
                                            {SOURCE_FORMAT_LABEL[sourceFormat].guide.map((line) => <li key={line}>{line}</li>)}
                                        </ul>
                                    </div>
                                </aside>
                            </div>

                            <footer className="drama-paste-foot">
                                <span className="drama-paste-foot-hint">解析后会回到立项页，先确认风格、集数与预算再开跑。</span>
                                <div className="drama-paste-actions">
                                    <Button onClick={() => setPasteMode(false)}>取消</Button>
                                    <Button
                                        type="primary"
                                        className="drama-paste-submit"
                                        disabled={!pasteText.trim()}
                                        onClick={() => loadText(pasteText)}
                                    >
                                        解析正文并立项
                                    </Button>
                                </div>
                            </footer>
                        </div>
                    ) : (
                        <div className="drama-studio-hub">
                            {/* 1. 舞台标题：一行字母级距标签 + 大字号主张，替代原来「小标题 + 小卡片」的挂件式版面 */}
                            <header className="drama-hub-hero">
                                <span className="drama-hub-eyebrow">AI SHORT DRAMA STUDIO</span>
                                <h1>
                                    <span className="drama-hub-hero-mark">AI</span> 短剧创作
                                </h1>
                                <p>一句话立项，从小说到成片，一个人跑完整条流水线。</p>
                            </header>

                            {/* 2. 单卡双 Tab：一句话立项 / 导入剧本 */}
                            <div className="drama-hub-console">
                                <div className="drama-hub-tabs" role="tablist" aria-label="选择立项方式">
                                    <button type="button" role="tab" aria-selected={hubTab === "idea"} className="drama-hub-tab" onClick={() => setHubTab("idea")}>
                                        <PencilLine aria-hidden="true" />
                                        <span>一句话立项</span>
                                    </button>
                                    <button type="button" role="tab" aria-selected={hubTab === "import"} className="drama-hub-tab" onClick={() => setHubTab("import")}>
                                        <FileUp aria-hidden="true" />
                                        <span>导入剧本</span>
                                    </button>
                                </div>

                                {hubTab === "idea" ? (
                                    <div className="drama-hub-panel" role="tabpanel">
                                        <div className="drama-hub-quick-bar">
                                            <input
                                                className="drama-hub-quick-input"
                                                value={quickIdea}
                                                onChange={(e) => setQuickIdea(e.target.value)}
                                                onKeyDown={(e) => { if (e.key === "Enter") handleQuickStart(); }}
                                                placeholder="输入核心剧作主线，例如：退隐保镖重出江湖，解开昔日悬案迷局..."
                                                aria-label="短剧灵感主线"
                                            />
                                            <Button
                                                type="primary"
                                                className="drama-hub-quick-btn"
                                                disabled={!quickIdea.trim()}
                                                onClick={handleQuickStart}
                                            >
                                                立即立项
                                            </Button>
                                        </div>
                                        <div className="drama-hub-quick-tags" role="group" aria-label="快捷题材灵感">
                                            {QUICK_GENRES.map((genre) => (
                                                <button
                                                    key={genre.label}
                                                    type="button"
                                                    className="drama-hub-quick-tag"
                                                    onClick={() => setQuickIdea(genre.text)}
                                                >
                                                    {genre.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="drama-hub-panel" role="tabpanel">
                                        <div className="drama-hub-import">
                                            <div className="drama-hub-import-actions">
                                                <Button type="primary" className="drama-hub-import-btn" onClick={() => fileInputRef.current?.click()}>
                                                    <FileUp className="size-3.5" aria-hidden="true" />
                                                    <span>选择文件</span>
                                                </Button>
                                                <Button className="drama-hub-import-btn" onClick={() => setPasteMode(true)}>
                                                    <ClipboardPaste className="size-3.5" aria-hidden="true" />
                                                    <span>粘贴文稿</span>
                                                </Button>
                                            </div>
                                            <p className="drama-hub-import-hint">支持 TXT / Markdown（最大 40MB），自动识别章节与分集；也可以直接把文件拖进页面任意区域。</p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 3. 如果用户已有短剧作品，在下方优雅陈列；管理模式下可勾选批量删除 */}
                            {existingDramas.length ? (
                                <div className="drama-hub-projects">
                                    <div className="drama-hub-projects-head">
                                        <div className="drama-hub-projects-title">
                                            <span>我的短剧作品</span>
                                            {managing
                                                ? <span className="drama-hub-projects-selected">已选 {selectedDramas.length}</span>
                                                : <span className="drama-hub-projects-count">{existingDramas.length} 部</span>}
                                        </div>
                                        <button
                                            type="button"
                                            className="drama-hub-manage-btn"
                                            onClick={() => { setManaging(!managing); setSelectedDramas([]); }}
                                        >
                                            {managing ? "完成" : "管理"}
                                        </button>
                                    </div>
                                    <div className="drama-library-grid">
                                        {existingDramas.map((item) => (
                                            <DramaHubCard
                                                key={item.project.id}
                                                item={item}
                                                managing={managing}
                                                selected={selectedDramas.includes(item.project.id)}
                                                onToggle={() => toggleDramaSelected(item.project.id)}
                                            />
                                        ))}
                                    </div>
                                    {managing ? (
                                        <div className="drama-hub-delete-bar" role="toolbar" aria-label="批量删除短剧">
                                            <span className="drama-hub-delete-hint">{selectedDramas.length ? `已选择 ${selectedDramas.length} 个项目` : "请选择要删除的项目"}</span>
                                            <div className="drama-hub-delete-actions">
                                                <button
                                                    type="button"
                                                    className="drama-hub-delete-btn"
                                                    disabled={!selectedDramas.length || selectedDramas.length === existingDramas.length}
                                                    onClick={() => setSelectedDramas(existingDramas.map((item) => item.project.id))}
                                                >
                                                    全选
                                                </button>
                                                <button
                                                    type="button"
                                                    className="drama-hub-delete-btn is-danger"
                                                    disabled={!selectedDramas.length || deleteDramasMutation.isPending}
                                                    onClick={confirmDeleteSelected}
                                                >
                                                    {deleteDramasMutation.isPending ? "删除中…" : "删除"}
                                                </button>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}

                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".txt,.md,.markdown,text/plain,text/markdown"
                                className="hidden"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) void loadFile(file);
                                    event.target.value = "";
                                }}
                            />
                        </div>
                    )}
                </div>
            </WorkspacePage>
        );
    }

    return (
        <WorkspacePage fluid scroll={false}>
            <div className="drama-root drama-compose">
                {/* 左：小说目录 */}
                <aside className="drama-compose-novel">
                    <header className="drama-compose-head">
                        <Button
                            type="text"
                            shape="circle"
                            icon={<ArrowLeft className="size-4" />}
                            aria-label="返回立项页"
                            onClick={() => {
                                reset();
                                navigate("/projects", { replace: true });
                            }}
                        />
                        <strong className="m-0 flex items-center text-sm font-semibold leading-none text-foreground">新建短剧</strong>
                        <Button size="small" type="text" className="!ml-auto text-xs text-muted-foreground hover:text-foreground" onClick={reset}>
                            换素材
                        </Button>
                    </header>
                    <div className="drama-stats">
                        <div className="drama-stat">
                            <div className="drama-stat-value">{formatCount(analysis.chapters.length)}</div>
                            <div className="drama-stat-label">{perEpisode ? "段原文" : "章节"}</div>
                        </div>
                        <div className="drama-stat">
                            <div className="drama-stat-value">{formatCount(analysis.words)}</div>
                            <div className="drama-stat-label">字</div>
                        </div>
                        <div className="drama-stat">
                            <div className="drama-stat-value">{estimate ? `≈${estimate.episodes}` : "—"}</div>
                            <div className="drama-stat-label">集</div>
                        </div>
                    </div>
                    {analysis.issues.length ? (
                        <div className="drama-issues">
                            {analysis.issues.map((issue) => (
                                <div key={issue.kind} className="drama-issue">
                                    <AlertTriangle className="size-3.5" />
                                    {issue.message}
                                </div>
                            ))}
                        </div>
                    ) : null}
                    <div className="drama-chapter-list thin-scrollbar" role="listbox" aria-label="章节">
                        {analysis.chapters.slice(0, 600).map((chapter, index) => (
                            <button
                                key={`${index}-${chapter.title}`}
                                type="button"
                                role="option"
                                aria-selected={index === previewIndex}
                                className={`drama-chapter-row !min-h-[40px] !text-[14px] ${(perEpisode ? sourceChars(chapter.text) > EPISODE_SOURCE_CHARS : chapter.words < 200) ? "is-warn" : ""}`}
                                onClick={() => setPreviewIndex(index)}
                            >
                                <span className="is-num !text-[12px] font-mono">{String(index + 1).padStart(3, "0")}</span>
                                <span className="truncate text-left !text-[14px] font-medium text-foreground">{chapter.title}</span>
                                <span className="is-count !text-[12px]">{formatCount(chapter.words)}</span>
                            </button>
                        ))}
                        {analysis.chapters.length > 600 ? <div className="px-4 py-3 text-center text-xs text-foreground/40">另有 {analysis.chapters.length - 600} {unitLabel}</div> : null}
                    </div>
                </aside>

                {/* 中：视觉风格、角色基准与分镜审阅 */}
                <main className="drama-compose-main thin-scrollbar">
                    <section>
                        <div className="drama-section-title">
                            <h2>素材与分集</h2>
                            <span>{sourceFormat === "novel" ? "引号里的对白逐字保留为台词，不会被改写" : "剧本与分镜每个标题就是一集，台词逐字保留"}</span>
                        </div>
                        <div className="grid gap-3">
                            <SourceFormatPicker value={sourceFormat} onChange={setSourceFormat} row />
                            {sourceFormat === "novel" ? (
                                <div className="drama-media-modes is-row is-two" role="radiogroup" aria-label="分集方式">
                                    {EPISODE_MODES.map((mode) => (
                                        <button key={mode.value} type="button" role="radio" aria-checked={chapterMode === mode.value} className="drama-media-mode" onClick={() => setChapterMode(mode.value)}>
                                            <span className="drama-radio" />
                                            <span>
                                                <strong>
                                                    {mode.title}
                                                    {mode.value === "chapter" ? <em>推荐</em> : null}
                                                </strong>
                                                <span>{mode.detail}</span>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                            {sourceFormat === "novel" && perEpisode ? (
                                <EpisodeGroupField
                                    value={groupSize}
                                    onChange={setGroupSize}
                                    chapterCount={analysis.chapters.length}
                                    error={oversizedGroup ? `${oversizedGroup.label}合计 ${formatCount(oversizedGroup.chars)} 字，每集原文不超过 ${formatCount(EPISODE_GROUP_CHARS)} 字，请减少每集章数` : undefined}
                                />
                            ) : null}
                        </div>
                    </section>
                    <DramaStylePicker value={styleId} onChange={setStyleId} />
                    <section>
                        <div className="drama-section-title">
                            <h2>文字步骤</h2>
                            <span>每一步可以单独选文本模型和写作技能；不选就用默认文本模型和内置写法</span>
                        </div>
                        <DramaTextSteps
                            models={resolvedModels}
                            onModelsChange={(patch) => setModels((current) => ({ ...current, ...patch }))}
                            skills={{ bible: bibleSkill, script: scriptSkill, prompt: promptSkill }}
                            onSkillChange={(step, value) => (step === "bible" ? setBibleSkill(value) : step === "script" ? setScriptSkill(value) : setPromptSkill(value))}
                        />
                    </section>
                    <section>
                        <div className="drama-section-title">
                            <h2>参考图</h2>
                            <span>参考图是每个镜头保持人物一致的锚点；角色、道具、场景可以用不同的图片模型与分辨率，开工后也能在设置里改</span>
                        </div>
                        <div className="grid gap-3">
                            <DramaAssetImageModels models={resolvedModels} onModelsChange={(patch) => setModels((current) => ({ ...current, ...patch }))} assets={assets} onAssetsChange={setAssetDraft} />
                            <AssetSchemePicker value={assets} onChange={setAssetDraft} sample={{ style: style?.prompt || "", characterName: "主角", sceneName: "主场景" }} layout="compact" imageModel={imageOption} />
                        </div>
                    </section>
                    <section>
                        <div className="drama-section-title">
                            <h2>分镜规则</h2>
                            <span>决定剧情段多长、段内镜头节奏、台词密度、表演与运镜</span>
                        </div>
                        <StoryboardRules value={storyboard} onChange={setStoryboard} episodeSeconds={episodeSeconds} maxVideoSeconds={videoOption?.maxVideoSeconds} videoModelLabel={resolvedModels?.video?.label} />
                    </section>
                    <section>
                        <div className="drama-section-title">
                            <h2>审阅与交付方式</h2>
                            <span>决定生成过程中的把控节点</span>
                        </div>
                        <div className="drama-review-modes" role="radiogroup" aria-label="审阅方式">
                            {REVIEW_MODES.map((mode) => (
                                <button key={mode.value} type="button" role="radio" aria-checked={reviewMode === mode.value} className="drama-review-mode" onClick={() => setReviewMode(mode.value)}>
                                    <span className="drama-radio" />
                                    <span>
                                        <strong>{mode.title}</strong>
                                        <span>{mode.detail}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>
                    {previewChapter ? (
                        <section className="drama-compose-preview">
                            <div className="drama-section-title">
                                <h2>{previewChapter.title}</h2>
                                <span>选定章节文本 · {formatCount(previewChapter.words)} 字</span>
                            </div>
                            <div className="drama-compose-text thin-scrollbar">
                                {previewChapter.text.slice(0, 6000)}
                                {previewChapter.text.length > 6000 ? "……" : ""}
                            </div>
                        </section>
                    ) : null}
                </main>

                {/* 右：作品设置与启动 */}
                <aside className="drama-compose-side">
                    <div className="drama-compose-side-scroll thin-scrollbar">
                        <DramaLivePreviewCard
                            name={name}
                            aspectRatio={aspectRatio}
                            episodeSeconds={episodeSeconds}
                            style={style}
                            estimateEpisodes={estimate?.episodes}
                        />
                        <label className="block">
                            <div className="drama-option-label">作品名称</div>
                            <Input size="large" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="作品名称" />
                        </label>
                        <div>
                            <div className="drama-option-label">画幅</div>
                            <div className="drama-ratio-group" role="group" aria-label="画幅">
                                {RATIOS.map((ratio) => (
                                    <button key={ratio.value} type="button" className="drama-ratio" aria-pressed={aspectRatio === ratio.value} onClick={() => setAspectRatio(ratio.value)}>
                                        <span className="drama-ratio-shape" style={{ width: ratio.w, height: ratio.h }} />
                                        {ratio.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="block">
                                <div className="drama-option-label">单集时长</div>
                                <EpisodeDurationInput value={episodeSeconds} onChange={setEpisodeSeconds} />
                            </div>
                            <label className="block">
                                <div className="drama-option-label">对白语言</div>
                                <Select className="w-full" value={language} onChange={setLanguage} options={LANGUAGES.map((value) => ({ value, label: value }))} />
                            </label>
                        </div>
                        <div>
                            <div className="drama-option-label">生成节奏</div>
                            <div className="drama-media-modes" role="radiogroup" aria-label="生成节奏">
                                {(Object.keys(MEDIA_MODE_LABEL) as DramaMediaMode[]).map((mode) => (
                                    <button key={mode} type="button" role="radio" aria-checked={mediaMode === mode} className="drama-media-mode" onClick={() => setMediaMode(mode)}>
                                        <span className="drama-radio" />
                                        <span>
                                            <strong>
                                                {MEDIA_MODE_LABEL[mode].title}
                                                {mode === "manual" ? <em>推荐</em> : null}
                                            </strong>
                                            <span>{MEDIA_MODE_LABEL[mode].detail}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <div className="drama-option-label">段落衔接</div>
                            <div className="drama-media-modes" role="radiogroup" aria-label="段落衔接">
                                {(Object.keys(VIDEO_CONTINUITY_LABEL) as DramaVideoContinuity[]).map((mode) => (
                                    <button key={mode} type="button" role="radio" aria-checked={videoContinuity === mode} className="drama-media-mode" onClick={() => setVideoContinuity(mode)}>
                                        <span className="drama-radio" />
                                        <span>
                                            <strong>{VIDEO_CONTINUITY_LABEL[mode].title}</strong>
                                            <span>{VIDEO_CONTINUITY_LABEL[mode].detail}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                            {tailFrameProblem ? (
                                <p className="drama-cfg-note" role="alert">
                                    当前视频模型不支持图生视频，无法尾帧续接；请改用并行出片或换模型。
                                </p>
                            ) : null}
                        </div>
                        <section className="drama-compose-models" aria-label="制作模型">
                            <div className="drama-compose-models-head">
                                <Cpu className="size-4 text-[var(--workspace-accent)]" />
                                <strong>制作模型</strong>
                                <span>{catalogQuery.isLoading ? "正在读取可用模型…" : "已自动选好，可按需更换"}</span>
                            </div>
                            {(Object.keys(CAPABILITY_LABEL) as DramaCapability[]).map((capability) => (
                                <div key={capability} className="drama-compose-model-row">
                                    <span>{CAPABILITY_LABEL[capability]}</span>
                                    <DramaModelPicker
                                        capability={capability}
                                        size="sm"
                                        showPrice={false}
                                        aspectRatio={aspectRatio}
                                        videoResolution={videoResolution}
                                        value={resolvedModels?.[capability]}
                                        placeholder={`选择${CAPABILITY_LABEL[capability]}模型`}
                                        onChange={(choice) => setModels((current) => ({ ...current, [capability]: choice }))}
                                    />
                                </div>
                            ))}
                            <div className="drama-compose-model-row">
                                <span>视频分辨率</span>
                                <VideoResolutionField option={videoOption} value={videoResolution} onChange={setVideoResolution} />
                            </div>
                            {videoRatioProblem ? (
                                <p className="drama-cfg-note" role="alert">
                                    当前视频模型{videoRatioProblem}，请换模型或改画幅。
                                </p>
                            ) : null}
                            {videoOption?.generateAudio === false ? <p className="drama-cfg-note">当前视频模型不同步生成声音，剧情段视频没有对白与音效。</p> : null}
                        </section>
                        <div className="drama-field">
                            <div className="drama-field-label">
                                <span>预算上限</span>
                                <small>留空或 0 为不限，达到后自动暂停</small>
                            </div>
                            <InputNumber className="!w-full" min={0} precision={0} value={budgetCredits} onChange={(value) => setBudgetCredits(value ?? 0)} suffix="积分" aria-label="预算上限" />
                        </div>
                        {unavailableCapabilities.length ? (
                            <p className="flex items-start gap-2 text-[var(--fs-tiny)] leading-5 text-[var(--status-error)]">
                                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                还没有可用的{unavailableCapabilities.map((capability) => CAPABILITY_LABEL[capability]).join("、")}模型，请联系管理员在后台开通。
                            </p>
                        ) : null}
                        {noFittingVideo ? (
                            <p className="flex items-start gap-2 text-[var(--fs-tiny)] leading-5 text-[var(--status-error)]">
                                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                {videoContinuity === "tail_frame" ? `没有能按 ${aspectRatio} 尾帧续接出片的视频模型，请换画幅、改用并行出片或联系管理员。` : `没有能按 ${aspectRatio} 出片的视频模型，请换画幅或联系管理员。`}
                                {videoResolution ? "也可以把视频分辨率改回默认。" : ""}
                            </p>
                        ) : null}
                    </div>
                    <footer className="drama-compose-launch">
                        <div className="drama-compose-estimate">
                            <div>
                                <b>{estimate ? `${estimate.episodes} 集` : "—"}</b>
                                <span>约 {estimate?.durationMinutes ?? "—"} 分钟</span>
                            </div>
                            <div>
                                <b>{estimate ? formatCount(estimate.shots) : "—"}</b>
                                <span>镜头</span>
                            </div>
                            <div title={estimate?.priced ? `预计积分 ${formatCredits(estimate.minMicrocredits)}–${formatCredits(estimate.maxMicrocredits)}` : undefined}>
                                <b className="is-wrap">{estimate?.priced ? `${formatCredits(estimate.minMicrocredits)}–${formatCredits(estimate.maxMicrocredits)}` : "—"}</b>
                                <span>预计积分</span>
                            </div>
                        </div>
                        {mediaMode === "manual" ? (
                            <div className="text-[var(--fs-tiny)] text-foreground/50">开工只消耗文本模型费用；剧本、设定与段提示词确认后，再逐集生成参考图与视频</div>
                        ) : reviewMode === "sample" && estimate?.priced ? (
                            <div className="text-[var(--fs-tiny)] text-foreground/50">先做第 1 集样片，约 {formatCredits(estimate.sampleMicrocredits)} 积分，确认后再跑全剧</div>
                        ) : null}
                        {estimate?.note ? <div className="text-[var(--fs-micro)] text-foreground/40">{estimate.note}</div> : null}
                        <Button type="primary" size="large" block icon={<Play className="size-4" />} disabled={!canStart} loading={create.isPending} onClick={() => create.mutate()}>
                            {mediaMode === "manual" ? "开始改编剧本与分镜" : "开始自动制作"}
                        </Button>
                    </footer>
                </aside>
            </div>
        </WorkspacePage>
    );
}

function DramaLivePreviewCard({
    name,
    aspectRatio,
    episodeSeconds,
    style,
    estimateEpisodes,
}: {
    name: string;
    aspectRatio: string;
    episodeSeconds: number;
    style: DramaStyle | undefined;
    estimateEpisodes?: number;
}) {
    const isPortrait = aspectRatio === "9:16";
    const isSquare = aspectRatio === "1:1";
    const coverUrl = style?.cover;

    return (
        <div className="drama-live-preview-box">
            <div className="drama-live-preview-head">
                <span className="text-[var(--fs-micro)] font-semibold tracking-wider text-muted-foreground uppercase">剧集实时预演</span>
                <span className="text-[var(--fs-nano)] text-muted-foreground tabular-nums">{aspectRatio}</span>
            </div>
            <div className="flex justify-center p-3">
                <div
                    className={cn(
                        "relative overflow-hidden rounded-xl border border-white/10 bg-black/60 shadow-lg transition-all duration-300",
                        isPortrait ? "w-[140px] aspect-[9/16]" : isSquare ? "w-[160px] aspect-square" : "w-[210px] aspect-[16/9]"
                    )}
                >
                    {coverUrl ? (
                        <img src={coverUrl} alt="" className="size-full object-cover opacity-85" />
                    ) : (
                        <div
                            className="size-full opacity-60"
                            style={{
                                background: style?.palette
                                    ? `linear-gradient(135deg, ${style.palette[0]} 0%, ${style.palette[1]} 50%, ${style.palette[2]} 100%)`
                                    : "linear-gradient(135deg, #1f1f2e, #111118)",
                            }}
                        />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />
                    <div className="absolute inset-x-2.5 bottom-2.5 flex flex-col gap-1 text-white">
                        <span className="inline-flex w-fit items-center gap-1 rounded bg-white/20 px-1 py-0.5 text-[9px] backdrop-blur-sm">
                            <Clapperboard className="size-2.5" />
                            {style?.name || "默认风格"}
                        </span>
                        <strong className="truncate text-xs font-semibold leading-tight text-white drop-shadow-sm">
                            {name || "短剧新篇"}
                        </strong>
                        <div className="flex items-center gap-1.5 text-[9px] text-white/70">
                            <span>{episodeSeconds}秒/集</span>
                            <span>·</span>
                            <span>{estimateEpisodes ? `共 ${estimateEpisodes} 集` : "自动分集"}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function DramaCover({ item }: { item: DramaListItem }) {
    const covers = (item.coverResourceIds?.length ? item.coverResourceIds : item.coverResourceId ? [item.coverResourceId] : []).slice(0, 4);
    if (!covers.length) {
        return (
            <div className="drama-library-cover is-empty">
                <span className="drama-library-glyph">{item.project.name.slice(0, 1)}</span>
                <Clapperboard className="drama-library-empty-icon" />
            </div>
        );
    }
    return (
        <div className={`drama-library-cover is-${covers.length}`}>
            {covers.map((id) => <span key={id}><MediaThumb resourceId={id} alt="" /></span>)}
        </div>
    );
}

function DramaHubCard({ item, managing = false, selected = false, onToggle }: { item: DramaListItem; managing?: boolean; selected?: boolean; onToggle?: () => void }) {
    const progress = item.episodeCount ? Math.round((item.doneCount / item.episodeCount) * 100) : 0;
    const stage = item.episodeCount ? `${item.doneCount}/${item.episodeCount} 集成片` : item.status === "running" ? "正在改编" : "准备中";
    const content = (
        <>
            <DramaCover item={item} />
            <span className={`drama-chip drama-library-badge is-${item.status}`}><span className="drama-dot" />{STATUS_LABEL[item.status]}</span>
            <div className="drama-library-body">
                <h3 title={item.project.name}>{item.project.name}</h3>
                <div className="drama-library-meta">
                    {item.styleName ? <span>{item.styleName}</span> : null}
                    <span>{item.aspectRatio}</span>
                    <RelativeTime value={item.updatedAt || item.project.updatedAt} />
                </div>
                <div className="drama-library-progress">
                    <span className="drama-library-progress-bar"><span style={progressFillStyle(Math.max(progress, 2))} /></span>
                    <span className="drama-library-progress-text"><b>{stage}</b></span>
                </div>
            </div>
        </>
    );
    // 管理模式：整卡变成勾选目标，右上角一颗圆勾；正常模式保持链接卡。
    if (managing) {
        return (
            <article className={`drama-library-card is-${item.status} is-manage${selected ? " is-selected" : ""}`}>
                <div
                    className="drama-library-open"
                    role="checkbox"
                    aria-checked={selected}
                    aria-label={`选择《${item.project.name}》`}
                    tabIndex={0}
                    onClick={onToggle}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle?.(); } }}
                >
                    {content}
                </div>
                <span className="drama-library-check" aria-hidden="true"><Check /></span>
            </article>
        );
    }
    return (
        <article className={`drama-library-card is-${item.status}`}>
            <Link to={`/projects/${item.project.id}`} className="drama-library-open" aria-label={`打开《${item.project.name}》`}>
                {content}
            </Link>
        </article>
    );
}
