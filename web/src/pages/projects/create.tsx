import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Input, InputNumber, Select } from "antd";
import { AlertTriangle, ArrowLeft, BookOpenText, Clapperboard, ClipboardPaste, FileUp, Sparkles, Wand2 } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { DEFAULT_DRAMA_STYLE_ID, findDramaStyle, type DramaStyle } from "@/lib/drama/drama-styles";
import { decodeNovelText } from "@/lib/canvas/canvas-document";
import { analyzeNovel, titleFromFileName, type NovelAnalysis } from "@/lib/drama/novel-parse";
import { ApiError } from "@/services/api/request";
import { dramaChoiceKey } from "@/lib/drama/model-choice";
import { DEFAULT_STORYBOARD } from "@/lib/drama/storyboard";
import { createDrama, estimateDrama, type DramaAssetSettings, type DramaCapability, type DramaMediaMode, type DramaModels, type DramaReviewMode, type DramaSkillRef, type DramaStoryboardSettings } from "@/services/api/drama";
import { cn } from "@/lib/utils";

import { formatCount, formatCredits, MEDIA_MODE_LABEL } from "./drama-shared";
import { AssetSchemePicker, defaultAssetSettings, useAssetSchemes } from "./asset-scheme";
import { DramaModelPicker, useDramaModelCatalog } from "./drama-model-picker";
import { PromptSkillField } from "./prompt-skill";
import { EpisodeDurationInput, StoryboardRules } from "./storyboard-rules";
import { DramaStylePicker } from "./style-picker";
import "./drama.css";

const MAX_FILE_BYTES = 40 * 1024 * 1024;
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
const CAPABILITY_LABEL: Record<DramaCapability, string> = { text: "改编与分镜", image: "角色与场景参考图", video: "剧情段视频" };

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
    const [analysis, setAnalysis] = useState<NovelAnalysis | null>(null);
    const [name, setName] = useState("");
    const [aspectRatio, setAspectRatio] = useState("9:16");
    const [episodeSeconds, setEpisodeSeconds] = useState(90);
    const [styleId, setStyleId] = useState(DEFAULT_DRAMA_STYLE_ID);
    const [language, setLanguage] = useState(LANGUAGES[0]);
    const [reviewMode, setReviewMode] = useState<DramaReviewMode>("sample");
    // 默认先只跑文本：先看剧情、镜头、设定和段提示词对不对，再决定花钱生成参考图与视频。
    const [mediaMode, setMediaMode] = useState<DramaMediaMode>("manual");
    const [storyboard, setStoryboard] = useState<DramaStoryboardSettings>(DEFAULT_STORYBOARD);
    const [promptSkill, setPromptSkill] = useState<DramaSkillRef>();
    const [models, setModels] = useState<Partial<DramaModels>>({});
    const [budgetCredits, setBudgetCredits] = useState<number | null>(null);
    const assetCatalog = useAssetSchemes();
    const [assetDraft, setAssetDraft] = useState<DramaAssetSettings>();
    const assets = assetDraft || defaultAssetSettings(assetCatalog.data);
    const [previewIndex, setPreviewIndex] = useState(0);

    const style = findDramaStyle(styleId);
    const catalogQuery = useDramaModelCatalog();
    const resolvedModels = useMemo<DramaModels | undefined>(() => {
        const defaults = catalogQuery.data?.defaults;
        if (!defaults) return undefined;
        return { text: models.text || defaults.text, image: models.image || defaults.image, video: models.video || defaults.video };
    }, [catalogQuery.data, models]);
    const videoOption = catalogQuery.data?.options.video?.find((option) => dramaChoiceKey(option.choice) === dramaChoiceKey(resolvedModels?.video));
    const missingCapabilities = (Object.keys(CAPABILITY_LABEL) as DramaCapability[]).filter((capability) => catalogQuery.data && !dramaChoiceKey(resolvedModels?.[capability]));
    const settings = {
        aspectRatio,
        episodeSeconds,
        stylePrompt: style?.prompt || "",
        styleName: style?.name || "",
        language,
        reviewMode,
        mediaMode,
        storyboard,
        ...(promptSkill ? { promptSkill } : {}),
        concurrency: 4,
        models: resolvedModels,
        ...(assets ? { assets } : {}),
    };
    const estimateQuery = useQuery({
        queryKey: ["drama-estimate", analysis?.chapters.length, analysis?.words, episodeSeconds, JSON.stringify(storyboard), dramaChoiceKey(resolvedModels?.text), dramaChoiceKey(resolvedModels?.image), dramaChoiceKey(resolvedModels?.video)],
        queryFn: ({ signal }) => estimateDrama({ chapterCount: analysis!.chapters.length, wordCount: analysis!.words, settings }, signal),
        enabled: Boolean(analysis && resolvedModels),
        staleTime: 30_000,
    });
    const estimate = estimateQuery.data;
    useEffect(() => {
        if (estimate && budgetCredits === null && estimate.maxMicrocredits > 0) setBudgetCredits(Math.ceil(estimate.maxMicrocredits / 1_000_000));
    }, [estimate, budgetCredits]);

    const loadText = (text: string, fileName?: string) => {
        const result = analyzeNovel(text);
        if (!result.chapters.length) {
            message.error("没有读取到正文，请检查文件内容");
            return;
        }
        setAnalysis(result);
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
    const handedFile = (location.state as { file?: File } | null)?.file;
    const handedRef = useRef(false);
    useEffect(() => {
        if (!handedFile || handedRef.current) return;
        handedRef.current = true;
        void loadFile(handedFile);
        // 文件只用于首次进入，清掉路由状态避免刷新或返回时重复解析。
        navigate(".", { replace: true, state: null });
    }, [handedFile]); // eslint-disable-line react-hooks/exhaustive-deps

    const initialIdea = searchParams.get("idea") || "";
    const ideaHandledRef = useRef(false);
    useEffect(() => {
        if (!initialIdea || ideaHandledRef.current) return;
        ideaHandledRef.current = true;
        const ideaTitle = initialIdea.slice(0, 16);
        const storyText = `第一章：初露风芒\n${initialIdea}\n\n第二章：逆风破局\n对立激化，主角绝地突围，展现关键抉择。\n\n第三章：终局定音\n局势扭转，高潮反转收尾。`;
        setName(ideaTitle);
        loadText(storyText, `${ideaTitle}.txt`);
    }, [initialIdea]);
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
            }),
        onSuccess: (summary) => navigate(`/projects/${summary.project.id}`, { replace: true }),
        onError: (error) => message.error(error instanceof ApiError || error instanceof Error ? error.message : "创建失败"),
    });
    const canStart = Boolean(analysis && name.trim() && resolvedModels && missingCapabilities.length === 0 && !create.isPending);

    const previewChapter = analysis?.chapters[previewIndex];
    const reset = () => {
        setAnalysis(null);
        setPasteText("");
        setName("");
        setPreviewIndex(0);
    };

    if (!analysis) {
        return (
            <WorkspacePage fluid scroll={false}>
                <div className="drama-root drama-compose-empty flex h-full min-h-0 flex-col p-4">
                    <div
                        className={`drama-drop ${dragOver ? "is-over" : ""}`}
                        onDragOver={(event) => {
                            event.preventDefault();
                            setDragOver(true);
                        }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={onDrop}
                    >
                        {pasteMode ? (
                            <div className="grid w-full max-w-[860px] gap-3">
                                <Input.TextArea
                                    autoFocus
                                    value={pasteText}
                                    onChange={(event) => setPasteText(event.target.value)}
                                    placeholder="粘贴小说正文。包含“第一章 / 第1章 / Chapter 1”这类标题时会自动拆章。"
                                    autoSize={{ minRows: 14, maxRows: 24 }}
                                />
                                <div className="flex justify-end gap-2">
                                    <Button onClick={() => setPasteMode(false)}>取消</Button>
                                    <Button type="primary" disabled={!pasteText.trim()} onClick={() => loadText(pasteText)}>
                                        解析正文
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <span className="drama-drop-icon">
                                    <BookOpenText className="size-7" />
                                </span>
                                <h2>拖入小说文件，剩下的交给流水线</h2>
                                <p>TXT 或 Markdown，自动识别 GBK / UTF-8 编码与章节标题。确认几个选项后，系统自动改编、拆集、建角色、出分镜并合成成片。</p>
                                <Button type="primary" size="large" icon={<FileUp className="size-4" />} onClick={() => fileInputRef.current?.click()}>
                                    选择小说文件
                                </Button>
                                <button type="button" className="drama-link inline-flex items-center gap-1" onClick={() => setPasteMode(true)}>
                                    <ClipboardPaste className="size-3.5" />
                                    没有文件？直接粘贴正文
                                </button>
                                <div className="mt-4 w-full max-w-[560px] rounded-2xl border border-white/10 bg-white/[.03] p-4 text-left backdrop-blur-sm">
                                    <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-foreground">
                                        <Clapperboard className="size-3.5 text-primary" />
                                        <span>从故事梗概快速立项</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            className="!h-10 !rounded-xl !bg-black/30"
                                            value={quickIdea}
                                            onChange={(e) => setQuickIdea(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter" && quickIdea.trim()) {
                                                    const ideaTitle = quickIdea.trim().slice(0, 16);
                                                    const storyText = `第一章：初露风芒\n${quickIdea.trim()}\n\n第二章：逆风破局\n对立激化，主角绝地突围，展现关键抉择。\n\n第三章：终局定音\n局势扭转，高潮反转收尾。`;
                                                    setName(ideaTitle);
                                                    loadText(storyText, `${ideaTitle}.txt`);
                                                }
                                            }}
                                            placeholder="输入核心剧情主线，例如：隐姓退役军官重返都市，退婚之日意外卷入..."
                                        />
                                        <Button
                                            type="primary"
                                            className="!h-10 !rounded-xl !px-4"
                                            disabled={!quickIdea.trim()}
                                            onClick={() => {
                                                const ideaTitle = quickIdea.trim().slice(0, 16);
                                                const storyText = `第一章：初露风芒\n${quickIdea.trim()}\n\n第二章：逆风破局\n对立激化，主角绝地突围，展现关键抉择。\n\n第三章：终局定音\n局势扭转，高潮反转收尾。`;
                                                setName(ideaTitle);
                                                loadText(storyText, `${ideaTitle}.txt`);
                                            }}
                                        >
                                            立项短剧
                                        </Button>
                                    </div>
                                </div>
                                <div className="drama-drop-steps">
                                    {["解析章节", "建立角色、道具与场景", "分集改编与段提示词", "按剧情段生成视频", "合成成片"].map((step, index) => (
                                        <span key={step}>
                                            <b>{index + 1}</b>
                                            {step}
                                        </span>
                                    ))}
                                </div>
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
                            </>
                        )}
                    </div>
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
                        <Link to="/projects">
                            <Button type="text" shape="circle" icon={<ArrowLeft className="size-4" />} aria-label="返回作品列表" />
                        </Link>
                        <h1>新建短剧</h1>
                        <Button size="small" type="text" className="!ml-auto" onClick={reset}>
                            换一本
                        </Button>
                    </header>
                    <div className="drama-stats">
                        <div className="drama-stat">
                            <div className="drama-stat-value">{formatCount(analysis.chapters.length)}</div>
                            <div className="drama-stat-label">章节</div>
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
                            <button key={`${index}-${chapter.title}`} type="button" role="option" aria-selected={index === previewIndex} className={`drama-chapter-row ${chapter.words < 200 ? "is-warn" : ""}`} onClick={() => setPreviewIndex(index)}>
                                <span className="is-num">{String(index + 1).padStart(3, "0")}</span>
                                <span className="truncate text-left">{chapter.title}</span>
                                <span className="is-count">{formatCount(chapter.words)}</span>
                            </button>
                        ))}
                        {analysis.chapters.length > 600 ? <div className="px-4 py-3 text-center text-[var(--fs-tiny)] text-foreground/40">另有 {analysis.chapters.length - 600} 章</div> : null}
                    </div>
                </aside>

                {/* 中：视觉风格、角色基准与分镜审阅 */}
                <main className="drama-compose-main thin-scrollbar">
                    <DramaStylePicker value={styleId} onChange={setStyleId} />
                    <section>
                        <div className="drama-section-title">
                            <h2>角色参考图方案</h2>
                            <span>用于每个镜头保持人物长相与装束一致，开工后可随时更换</span>
                        </div>
                        <AssetSchemePicker value={assets} onChange={setAssetDraft} sample={{ style: style?.prompt || "", characterName: "主角", sceneName: "主场景" }} layout="compact" />
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
                    <section>
                        <div className="drama-section-title">
                            <h2>分镜规则</h2>
                            <span>控制剧情段时长、段内镜头节奏、台词密度与视听转场</span>
                        </div>
                        <StoryboardRules value={storyboard} onChange={setStoryboard} episodeSeconds={episodeSeconds} maxVideoSeconds={videoOption?.maxVideoSeconds} videoModelLabel={resolvedModels?.video?.label} />
                    </section>
                    <section>
                        <div className="drama-section-title">
                            <h2>提示词写作技能</h2>
                            <span>撰写每个剧情段提示词遵循的方法库</span>
                        </div>
                        <PromptSkillField value={promptSkill} onChange={setPromptSkill} />
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
                        <section className="drama-compose-models" aria-label="制作模型">
                            <div className="drama-compose-models-head">
                                <Wand2 className="size-4 text-[var(--workspace-accent)]" />
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
                                        value={resolvedModels?.[capability]}
                                        placeholder={`选择${CAPABILITY_LABEL[capability]}模型`}
                                        onChange={(choice) => setModels((current) => ({ ...current, [capability]: choice }))}
                                    />
                                </div>
                            ))}
                        </section>
                        <div className="drama-field">
                            <div className="drama-field-label">
                                <span>预算上限</span>
                                <small>留空或 0 为不限，达到后自动暂停</small>
                            </div>
                            <InputNumber className="!w-full" min={0} precision={0} value={budgetCredits} onChange={(value) => setBudgetCredits(value ?? 0)} suffix="积分" aria-label="预算上限" />
                        </div>
                        {missingCapabilities.length ? (
                            <p className="flex items-start gap-2 text-[var(--fs-tiny)] leading-5 text-[var(--status-error)]">
                                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                还没有可用的{missingCapabilities.map((capability) => CAPABILITY_LABEL[capability]).join("、")}模型，请联系管理员在后台开通。
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
                            <div>
                                <b>{estimate?.priced ? `${formatCredits(estimate.minMicrocredits)}–${formatCredits(estimate.maxMicrocredits)}` : "—"}</b>
                                <span>预计积分</span>
                            </div>
                        </div>
                        {mediaMode === "manual" ? (
                            <div className="text-[var(--fs-tiny)] text-foreground/50">开工只消耗文本模型费用；剧本、设定与段提示词确认后，再逐集生成参考图与视频</div>
                        ) : reviewMode === "sample" && estimate?.priced ? (
                            <div className="text-[var(--fs-tiny)] text-foreground/50">先做第 1 集样片，约 {formatCredits(estimate.sampleMicrocredits)} 积分，确认后再跑全剧</div>
                        ) : null}
                        {estimate?.note ? <div className="text-[var(--fs-micro)] text-foreground/40">{estimate.note}</div> : null}
                        <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} disabled={!canStart} loading={create.isPending} onClick={() => create.mutate()}>
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
