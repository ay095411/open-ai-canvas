# 算力AI

该目录是独立官方协议插件源码。后端从生成的 `suanliai.yingce-plugin` 包加载，不依赖系统内置 `host:` 适配器。

插件只贡献一个 provider：`suanliai-video`。算力AI 是聚合网关，已经把站内全部视频模型（001–009 系列、SVIP、专享、官方直连 1/2/3 区、炳火、wan3、MiniMax H3 等）收敛到同一套 OpenAI `/v1/videos` 异步任务接口，字段、状态词和参数收敛规则完全一致，因此不需要像 Grsai 那样按模型族拆成多个协议。

`/v1/chat/completions`、`/v1/images/*` 属于标准线格式，直接选用现有通用协议即可，本插件不为它们重复声明。

完整接口见 [docs/interface.md](docs/interface.md)。
