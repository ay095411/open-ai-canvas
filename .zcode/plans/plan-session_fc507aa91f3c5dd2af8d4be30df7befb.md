# 积分中心弹窗优化方案（移除兑换底部卡片 & 存储空间套餐样式精修）

经过代码探索与实机视觉审查，针对用户的两项需求提出以下具体实现方案：

---

### 一、兑换 Tab：移除底部三个服务保障卡片
1. **组件代码清理** (`web/src/components/layout/workspace-wallet-modal.tsx`)：
   - 彻底移除 `is-redeem` 内部的 `<div className="workspace-wallet-redeem-guarantees">...</div>`（包含即时充值入账、积分永久有效、多端实时互通 3 个卡片）；
   - 移除文件顶部仅被这三个卡片使用的 Lucide 图标引用：`Globe2`、`ShieldCheck`、`Zap`。
2. **样式优化** (`web/src/styles/globals.css`)：
   - 清理未使用的 `.workspace-wallet-redeem-guarantees` 及其子元素样式；
   - 优化 `.workspace-wallet-content.is-redeem` 容器布局：设置合理的 `max-width: 640px; margin: 36px auto;`，让卡密输入卡片在大弹窗中居中沉稳排布，告别突兀的纯黑大空洞。

---

### 二、充值 Tab：重塑「存储空间套餐」视觉与排版

针对当前截图暴露出的“进度条是一根细弱暗线、信息水平挤作一团、空态是一个冰冷的大黑框”等问题，进行影视工业级质感重塑：

#### 1. 升级为「云盘存储健康度仪表盘卡片」(`StorageSummary`)
- **层次分明的结构化布局**：
  - **头部指标行**：左侧展示大字号数字「当前已用空间 `1.5 MB` / `20 GB`」，右侧搭配状态胶囊徽标（如 `已用 <0.1%`，超额时显式橙/红报警）；
  - **高光胶囊进度条**：高度提升至 `6px`，带平滑内凹槽与科技蓝霓虹光晕渐变（`linear-gradient(90deg, #38bdf8, #2563eb)`），超额时切换至预警黄或危险红；
  - **底部配额对账行**：清晰显示「系统基础 `20 GB`」与「剩余可用 `20 GB`」；若有已生效的扩容订单，以精致的等宽字号微标签展示（如 `+100 GB · 永久`）。

#### 2. 增强存储空间套餐商品卡片 (`ProductCard.is-storage`)
- **冷光云盘专属质感**：
  - 与消耗性代币（积分）拉开视觉层级，背景融入微弱科技蓝漫反射（`radial-gradient`）；
  - 扩容数值（如 `+50 GB`、`+200 GB`、`+1 TB`）升级为醒目大字号等宽数字（18px）；
  - 选中态：应用专属的科技蓝霓虹光晕与精密描边，告别生硬的全局紫色覆盖。

#### 3. 美化暂无套餐时的空态展示 (`wallet-topup-group-empty`)
- 从当前单调的简陋黑框，升级为带有温和云盘底纹插画、双行排版的精致容器：
  - 标题：`当前暂未上架专属扩容套餐`
  - 提示：`如需大容量团队或商业归档存储，可使用卡密兑换或联系管理员`。

---

### 三、涉及文件与实施步骤
1. 修改 `web/src/components/layout/workspace-wallet-modal.tsx`（移除兑换页保障卡片与无用 import）；
2. 修改 `web/src/components/layout/workspace-wallet-topup.tsx`（重塑 `StorageSummary` 结构与语义）；
3. 修改 `web/src/components/layout/workspace-wallet-topup.css` 与 `web/src/styles/globals.css`（写入高质感存储卡片、仪表盘、进度条与兑换居中排版样式）；
4. 运行 `bun run typecheck` 与 `bun run build` 确保零错误；
5. 在浏览器中对两个 Tab 重新实机截图核验。
