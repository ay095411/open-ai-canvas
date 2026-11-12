# Grsai

该目录是独立官方协议插件源码。后端从生成的 `grsai.yingce-plugin` 包加载，不依赖系统内置 `host:` 适配器。

插件贡献四个 provider：`grsai-video`（MiniMax H3）、`grsai-wan-video`（Wan 3.0）、`grsai-agnes-video`（Agnes 2.5）与 `grsai-image`。前三个共用同一端点，但参数值域与数量上限互不相同，因此按模型族拆开，而不是用一个视频协议硬覆盖。

`/v1/chat/completions`、`/v1/images/*` 与 Gemini 原生格式属于标准线格式，直接选用现有通用协议即可，本插件不为它们重复声明。

完整接口见 [docs/interface.md](docs/interface.md)。
