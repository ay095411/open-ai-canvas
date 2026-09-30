# OPPO Sans 4.0

- 来源：用户提供的 OPPO Sans 4.0 字体包，包含原始字体与许可说明。
- 字体内部版本：1.8100；字重轴：100–700，默认 400。
- `oppo-sans-4.0.ttf` 为原始文件，仅调整文件名，未转换、裁剪或修改内容。
- SHA-256：`4f58dbaeea78ebe9dafaadd2bec60f50983ef15de31605beff55aac94420dd2`。
- 原始版权及许可全文位于 `web/public/fonts/oppo-sans/LICENSE.txt`，随应用分发；认证页提供字体使用声明及授权入口。
- 字体由 `web/src/styles/fonts.css` 引用，构建时生成带内容哈希的资源 URL；首次加载使用后备字体，避免隐藏页面文字。
- 默认字体通过页面根节点和 Ant Design 主题的 `--font-ui` 生效；代码、品牌及用户指定的创作字体按用途保留。
- `web/welcome/credits.html` 是 Vite 的独立 HTML 入口，与主站共用此字体；构建输出地址仍为 `/welcome/credits.html`。使用现有 `bun run build` 构建并整体发布 `dist`，无需调整服务器路由。
