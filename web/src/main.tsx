import "@fontsource-variable/inter";
import "./styles/fonts.css";
import "@fontsource-variable/jetbrains-mono";
// 品牌名展示体：Fredoka（SIL OFL 1.1）。只引入 wght 轴入口，latin 子集 29.7KB；
// 想再要宽度轴（font-stretch 75%–125%）就换成 "@fontsource-variable/fredoka/standard.css"，
// 代价是 latin 子集涨到 67.8KB。
import "@fontsource-variable/fredoka";
import { installChunkRecovery } from "@/lib/chunk-recovery";
import { bootstrapAppearance } from "@/services/appearance-bootstrap";
import { isIsolatedDirectorRepro } from "@/lib/dev-repro";

installChunkRecovery();

// The public film entry checks its availability independently of workspace bootstrap.
if (/^\/welcome\/?$/.test(window.location.pathname)) void import("./welcome-application");
else {
    // The backend-free DEV lab must not make requests before AppProviders isolates it.
    const appearanceReady = isIsolatedDirectorRepro(import.meta.env.DEV, window.location.pathname) ? Promise.resolve() : bootstrapAppearance();
    void import("./application");
    void appearanceReady.catch(() => undefined);
}
