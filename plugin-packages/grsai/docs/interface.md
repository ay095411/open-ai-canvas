# Grsai 接口字段

## 协议身份

- 插件 ID：`grsai`。
- Provider ID：`grsai-video`、`grsai-wan-video`、`grsai-agnes-video`、`grsai-image`。
- 能力：`video`、`video`、`video`、`image`。
- 默认 Base URL：`https://grsaiapi.com`（全球节点）；国内节点为 `https://grsai.dakka.com.cn`，在渠道里覆盖 Base URL 即可切换。
- 鉴权驱动：`bearer`。
- 创建：`POST /v1/api/generate`。
- 查询：`GET /v1/api/result?id=<任务 ID>`。
- 生命周期：异步任务轮询。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key，在 `https://grsai.ai/zh/dashboard/api-keys` 获取。 |

## 为什么按模型族拆分

Grsai 的图片与视频共用 `POST /v1/api/generate`，靠 `model` 区分。但三个视频模型的参数值域和数量上限互不相同，合在一个协议里必然误伤：

| 约束 | `grsai-video`（H3） | `grsai-wan-video`（Wan 3.0） | `grsai-agnes-video`（Agnes 2.5） |
| --- | --- | --- | --- |
| `model` 取值 | `minimax-h3` | `wan-3.0` | `agnes-video-2.5` |
| `aspectRatio` | 画布比例自动换算为 `portrait` / `landscape` | `16:9` `9:16` `21:9` `4:3` `1:1` `3:4` | 同 Wan 3.0 |
| `resolution` | `480p` `768p` `1080p` | `480p` `720p` `1080p` | `720p` `1080p` `2k` |
| `duration` | 1~15 秒，1080p 下 ≤10 秒 | 2~30 秒 | 4~12 秒 |
| 参考图上限 | 9 张 | 10 张 | 5 张 |
| 参考音频上限 | 3 段 | 5 段（每段 ≤15 秒） | 3 段 |
| `promptSkill` | 支持，默认开启 | **不支持** | **不支持** |

合并成一个协议会出现三种硬伤：给 Wan 3.0 发它不认识的 `promptSkill`、分辨率下拉里缺 `720p` 和 `2k`、把 Wan 的 10 张参考图按 H3 的 9 张拦掉。因此每个模型一个 provider，并在创建前校验 `model` 必须与所选协议一致；选错协议会在本地直接报错，而不是等上游返回一个难读的失败。

## 统一字段映射（视频）

三个视频 provider 的字段名一致，差异只在取值与上限。

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 必须与所选协议对应的模型一致。 |
| `prompt` | string | 是 | `prompt` | 视频提示词；H3 需要分镜级提示词。 |
| `images` | media[] | 否 | `images` / `firstFrame` / `lastFrame` | 参考图或首尾帧，见互斥规则。 |
| `audios` | media[] | 否 | `audios` | 参考音频。 |
| `aspectRatio` | string | 是 | `aspectRatio` | 取值见上表。 |
| `resolution` | string | 是 | `resolution` | 取值见上表。 |
| `duration` | integer | 是 | `duration` | 取值见上表。 |
| `seed` | integer | 否 | `providerOptions.<providerID>.seed` | 随机种子。 |
| `promptSkill` | boolean | 否 | `providerOptions.grsai-video.promptSkill` | 仅 `grsai-video` 支持，默认 `true`。 |
| `providerOptions` | object | 否 | `providerOptions.*` | 厂商扩展字段。 |

### 参考图与首尾帧的互斥规则

上游文档明确 `firstFrame` / `lastFrame` 与 `images` / `audios` 互斥，三个视频模型一致。插件按输入图片的 `role` 自动分流：

| 输入 | 上游字段 |
| --- | --- |
| 图片 `role = first_frame` | `firstFrame` |
| 图片 `role = last_frame` | `lastFrame` |
| 其余图片 | `images` 数组 |
| 音频 | `audios` 数组 |

只要检测到任一 `first_frame` 或 `last_frame`，插件就不再发送 `images` 与 `audios`。首帧与尾帧必须成对出现，单独给一张会在创建前被拒绝，而不是静默丢弃。

### H3 的宽高换算

画布提交的是 `16:9`、`9:16` 这类宽高比，而 H3 只认 `portrait` / `landscape` 两个方向值。协议在创建前按比例换算：

| 画布比例 | 发给 H3 |
| --- | --- |
| `9:16`、`3:4`、`2:3`、`1:2`、`4:5`、`9:21` | `portrait` |
| `16:9`、`4:3`、`21:9` 及其他 | `landscape` |
| 直接填 `portrait` / `landscape` | 原样透传 |

因此模型能力里的「画面比例」要按画布口径配置（如 `16:9`、`9:16`），不要填 `portrait`，否则创作端选不到比例。

### `promptSkill` 只属于 H3`grsai-video` 默认 `true`，上游会改写提示词。做短剧分镜时提示词本身已经带秒级切分和对白设计，改写反而会破坏节奏，这类场景应显式传 `false`。Wan 3.0 与 Agnes 2.5 的文档没有这个字段，因此对应协议里根本不声明它，避免发出未知字段。

## 统一字段映射（图片）

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | nano-banana 系列或 gpt-image 系列模型 ID。 |
| `prompt` | string | 是 | `prompt` | 图片提示词。 |
| `images` | media[] | 否 | `images` | 参考图，支持 URL 与 Base64。 |
| `aspectRatio` | string | 否 | `aspectRatio` | 比例或像素值，取值随模型不同。 |
| `imageSize` | string | 否 | `providerOptions.grsai-image.imageSize` | `1K` / `2K` / `4K`，nano-banana 系列使用。 |
| `quality` | string | 否 | `quality` | gpt-image 系列质量档位。 |
| `background` | string | 否 | `providerOptions.grsai-image.background` | `transparent` 时输出透明背景。 |
| `outputFormat` | string | 否 | `providerOptions.grsai-image.outputFormat` | `png` / `gif` / `svg`。 |
| `providerOptions` | object | 否 | `providerOptions.*` | 厂商扩展字段。 |

图片协议不限定 `model`，因为 nano-banana 与 gpt-image 两个系列的公共字段一致，差异集中在 `aspectRatio` 的取值形态上。`aspectRatio` 的取值规则按模型分派，插件不做换算，原样透传：

- nano-banana 系列：`auto`、`1:1`、`16:9`、`9:16`、`4:3`、`3:4`、`3:2`、`2:3`、`5:4`、`4:5`、`21:9`；nano-banana-2 系列额外支持 `1:4`、`4:1`、`1:8`、`8:1`。
- gpt-image 普通系列：可填比例或 1K 像素值（如 `1024x1024`）。
- gpt-image 的 vip / flare / sunburst 系列：**只接受像素值**，填 `1:1` 会被上游拒绝；自定义像素需满足最长边 ≤ 3840、两边都是 16 的倍数、长短边比 ≤ 3:1。

## 上游请求模板逐字段清单

### 创建（`grsai-video` / `grsai-wan-video` / `grsai-agnes-video`）

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/api/generate"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.prompt` | `{"$ref":"request.prompt"}` |
| `create.body.replyType` | `"async"` |
| `create.body.aspectRatio` | H3 用 `$switch` 把画布比例换算成 `portrait` / `landscape`；Wan 与 Agnes 用 `{"$omitEmpty":{"$ref":"request.aspectRatio"}}` 原样透传 |
| `create.body.resolution` | `{"$omitEmpty":{"$ref":"request.resolution"}}` |
| `create.body.duration` | `{"$if":{"condition":{"$gt":[{"$ref":"request.duration"},0]},"then":{"$ref":"request.duration"},"else":null}}` |
| `create.body.seed` | `{"$if":{"condition":{"$gt":[{"$ref":"request.providerOptions.<id>.seed"},0]},"then":{"$ref":"request.providerOptions.<id>.seed"},"else":null}}` |
| `create.body.promptSkill` | 仅 `grsai-video`：`{"$coalesce":[{"$ref":"request.providerOptions.grsai-video.promptSkill"},true]}` |
| `create.body.images` | 无首尾帧时映射参考图 URL 数组，否则省略 |
| `create.body.audios` | 无首尾帧时映射参考音频 URL 数组，否则省略 |
| `create.body.firstFrame` | 存在 `first_frame` 时取第一张，否则省略 |
| `create.body.lastFrame` | 存在 `last_frame` 时取第一张，否则省略 |

`duration` 与 `seed` 用 `$if` 而不是 `$omitEmpty`，因为数值 `0` 在表达式里不算空值，会被原样发出；两者的语义都是 0 等于未指定。

### 创建（`grsai-image`）

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/api/generate"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.prompt` | `{"$ref":"request.prompt"}` |
| `create.body.replyType` | `"async"` |
| `create.body.aspectRatio` | `{"$omitEmpty":{"$ref":"request.aspectRatio"}}` |
| `create.body.images` | `{"$map":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","in":{"$ref":"media.value"}}}` |
| `create.body.imageSize` | `{"$omitEmpty":{"$ref":"request.providerOptions.grsai-image.imageSize"}}` |
| `create.body.quality` | `{"$omitEmpty":{"$coalesce":[{"$ref":"request.quality"},{"$ref":"request.providerOptions.grsai-image.quality"}]}}` |
| `create.body.background` | `{"$omitEmpty":{"$ref":"request.providerOptions.grsai-image.background"}}` |
| `create.body.outputFormat` | `{"$omitEmpty":{"$ref":"request.providerOptions.grsai-image.outputFormat"}}` |

### 查询（四个 provider 相同）

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `poll.method` | `"GET"` |
| `poll.path` | `"/v1/api/result"` |
| `poll.query.id` | `{"$ref":"taskId"}` |

## Provider 扩展键

- `providerOptions.grsai-video.seed`
- `providerOptions.grsai-video.promptSkill`
- `providerOptions.grsai-wan-video.seed`
- `providerOptions.grsai-agnes-video.seed`
- `providerOptions.grsai-image.imageSize`
- `providerOptions.grsai-image.quality`
- `providerOptions.grsai-image.background`
- `providerOptions.grsai-image.outputFormat`

动态模型允许使用文档声明的完整 `providerOptions` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应与错误映射

上游响应只有一层，创建与查询格式一致：

| 上游字段 | 统一字段 | 说明 |
| --- | --- | --- |
| `id` | 任务 ID | 查询时作为 `id` 参数回传。 |
| `status` | 任务状态 | 见下表归一化。 |
| `progress` | 进度 | 0~100，仅用于展示。 |
| `results[].url` | 视频 / 图片地址 | 直接作为媒体结果数组映射。 |
| `error` | 失败原因 | 非空时强制判定为失败。 |

状态归一化：上游的 `running` 映射为 `processing`，`violation` 与 `failed` 都映射为 `failed`，`succeeded` 映射为 `succeeded`，无法识别时按 `pending` 处理。`violation` 必须显式映射，否则宿主状态词表不认识它，任务会被当成「仍在进行」一直轮询到超时。

失败响应（HTTP 400）是 `{id, status, error}`，与成功响应同构，因此错误判定同时依赖 `status` 与 `error` 两个来源，HTTP 状态码、业务失败与空结果都不会被包装成成功。

## 结果有效期与两小时边界

上游有两条独立的两小时限制，插件对两者的处理方式不同：

- **任务超时 2 小时**：超过后任务自动失败并返还积分，轮询会收到 `failed`。
- **结果查询有效期 2 小时**：任务出结果后，查询接口只保留 2 小时，过期后即使拿到任务 ID 也查不到。

因此 `response.resultEphemeral` 为 `true`，宿主会在拿到地址后立即下载并转存到自己的存储，不把上游 URL 当作长期地址。

## 兼容边界

视频按模型族拆成三个 provider，因此 Grsai 新增视频模型时需要补一个 provider（参数族不同，无法复用）；图片协议不限定模型，新增同族图片模型直接填模型 ID 即可。

三个视频协议都在创建前校验 `model`、时长区间、分辨率与参考素材数量，把「选错协议」和「超限」拦在计费之前。取值是否在上游认可的枚举内仍由上游判定，插件只拦住文档明确写出的硬约束。

`/v1/chat/completions`、`/v1/images/generations`、`/v1/images/edits` 与 Gemini 原生格式都是标准线格式，复用现有通用协议，不在本插件内重复实现。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "grsai",
  "name": "Grsai",
  "version": "1.1.0",
  "author": "Grsai / 影策",
  "description": "Grsai 图片与视频异步生成协议插件，按模型族拆分为独立协议。",
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "grsai-video",
        "label": "Grsai 视频（MiniMax H3）",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://grsaiapi.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "values": [
              "minimax-h3"
            ],
            "mapping": "model",
            "description": "Grsai 视频（MiniMax H3） 仅支持 minimax-h3。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images/firstFrame/lastFrame",
            "description": "参考图或首尾帧，最多 9 张参考图；首尾帧必须成对，且与参考图、参考音频互斥。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "audios",
            "description": "参考音频，最多 3 段。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": true,
            "values": [
              "16:9",
              "9:16",
              "4:3",
              "3:4",
              "21:9"
            ],
            "mapping": "aspectRatio",
            "description": "画幅比例；上游只接受 portrait / landscape，插件按宽高自动换算。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": true,
            "values": [
              "480p",
              "768p",
              "1080p"
            ],
            "mapping": "resolution",
            "description": "分辨率档位。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": true,
            "mapping": "duration",
            "description": "视频时长秒数，1~15 秒。"
          },
          {
            "name": "seed",
            "type": "integer",
            "required": false,
            "mapping": "providerOptions.grsai-video.seed",
            "description": "随机种子，用于复现同一结果。"
          },
          {
            "name": "promptSkill",
            "type": "boolean",
            "required": false,
            "mapping": "providerOptions.grsai-video.promptSkill",
            "description": "提示词优化开关，默认开启；已有严格分镜脚本时建议关闭。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "厂商扩展字段，按 grsai-video 命名空间透传。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                0
              ]
            },
            "message": "Grsai MiniMax H3 不支持参考视频输入"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "as": "media",
                      "where": {
                        "$not": {
                          "$in": [
                            {
                              "$ref": "media.role"
                            },
                            [
                              "first_frame",
                              "last_frame"
                            ]
                          ]
                        }
                      }
                    }
                  }
                },
                9
              ]
            },
            "message": "Grsai MiniMax H3 最多支持 9 张参考图"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                3
              ]
            },
            "message": "Grsai MiniMax H3 最多支持 3 段参考音频"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "as": "media",
                      "where": {
                        "$eq": [
                          {
                            "$ref": "media.role"
                          },
                          "first_frame"
                        ]
                      }
                    }
                  }
                },
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "as": "media",
                      "where": {
                        "$eq": [
                          {
                            "$ref": "media.role"
                          },
                          "last_frame"
                        ]
                      }
                    }
                  }
                }
              ]
            },
            "message": "Grsai MiniMax H3 的首帧与尾帧必须同时提供"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$ref": "request.duration"
                    },
                    1
                  ]
                },
                {
                  "$lte": [
                    {
                      "$ref": "request.duration"
                    },
                    15
                  ]
                }
              ]
            },
            "message": "Grsai MiniMax H3 的时长需在 1~15 秒之间"
          },
          {
            "assert": {
              "$or": [
                {
                  "$ne": [
                    {
                      "$ref": "request.resolution"
                    },
                    "1080p"
                  ]
                },
                {
                  "$lte": [
                    {
                      "$ref": "request.duration"
                    },
                    10
                  ]
                }
              ]
            },
            "message": "Grsai MiniMax H3 在 1080p 下最多支持 10 秒"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "minimax-h3"
              ]
            },
            "message": "Grsai 视频（MiniMax H3） 仅支持 minimax-h3，请为该模型选择对应协议"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/api/generate",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "replyType": "async",
            "aspectRatio": {
              "$switch": {
                "cases": [
                  {
                    "when": {
                      "$in": [
                        {
                          "$ref": "request.aspectRatio"
                        },
                        [
                          "portrait",
                          "landscape"
                        ]
                      ]
                    },
                    "then": {
                      "$ref": "request.aspectRatio"
                    }
                  },
                  {
                    "when": {
                      "$in": [
                        {
                          "$ref": "request.aspectRatio"
                        },
                        [
                          "9:16",
                          "3:4",
                          "2:3",
                          "1:2",
                          "4:5",
                          "9:21"
                        ]
                      ]
                    },
                    "then": "portrait"
                  }
                ],
                "default": "landscape"
              }
            },
            "resolution": {
              "$omitEmpty": {
                "$ref": "request.resolution"
              }
            },
            "duration": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$ref": "request.duration"
                    },
                    0
                  ]
                },
                "then": {
                  "$ref": "request.duration"
                },
                "else": null
              }
            },
            "seed": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$ref": "request.providerOptions.grsai-video.seed"
                    },
                    0
                  ]
                },
                "then": {
                  "$ref": "request.providerOptions.grsai-video.seed"
                },
                "else": null
              }
            },
            "promptSkill": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.grsai-video.promptSkill"
                },
                true
              ]
            },
            "images": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$len": {
                          "$filter": {
                            "from": {
                              "$sortByOrder": {
                                "$ref": "request.images"
                              }
                            },
                            "as": "media",
                            "where": {
                              "$in": [
                                {
                                  "$ref": "media.role"
                                },
                                [
                                  "first_frame",
                                  "last_frame"
                                ]
                              ]
                            }
                          }
                        }
                      },
                      0
                    ]
                  },
                  "then": {
                    "$map": {
                      "from": {
                        "$filter": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "where": {
                            "$not": {
                              "$in": [
                                {
                                  "$ref": "media.role"
                                },
                                [
                                  "first_frame",
                                  "last_frame"
                                ]
                              ]
                            }
                          }
                        }
                      },
                      "as": "media",
                      "in": {
                        "$ref": "media.value"
                      }
                    }
                  },
                  "else": null
                }
              }
            },
            "audios": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$len": {
                          "$filter": {
                            "from": {
                              "$sortByOrder": {
                                "$ref": "request.images"
                              }
                            },
                            "as": "media",
                            "where": {
                              "$in": [
                                {
                                  "$ref": "media.role"
                                },
                                [
                                  "first_frame",
                                  "last_frame"
                                ]
                              ]
                            }
                          }
                        }
                      },
                      0
                    ]
                  },
                  "then": {
                    "$map": {
                      "from": {
                        "$ref": "request.audios"
                      },
                      "as": "media",
                      "in": {
                        "$ref": "media.value"
                      }
                    }
                  },
                  "else": null
                }
              }
            },
            "firstFrame": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "media.role"
                              },
                              "first_frame"
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                "then": {
                  "$first": {
                    "$map": {
                      "from": {
                        "$filter": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "media.role"
                              },
                              "first_frame"
                            ]
                          }
                        }
                      },
                      "as": "media",
                      "in": {
                        "$ref": "media.value"
                      }
                    }
                  }
                },
                "else": null
              }
            },
            "lastFrame": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "media.role"
                              },
                              "last_frame"
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                "then": {
                  "$first": {
                    "$map": {
                      "from": {
                        "$filter": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "media.role"
                              },
                              "last_frame"
                            ]
                          }
                        }
                      },
                      "as": "media",
                      "in": {
                        "$ref": "media.value"
                      }
                    }
                  }
                },
                "else": null
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/api/result",
          "contentType": "application/json",
          "query": {
            "id": {
              "$ref": "taskId"
            }
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$switch": {
              "cases": [
                {
                  "when": {
                    "$eq": [
                      {
                        "$ref": "response.status"
                      },
                      "running"
                    ]
                  },
                  "then": "processing"
                },
                {
                  "when": {
                    "$eq": [
                      {
                        "$ref": "response.status"
                      },
                      "violation"
                    ]
                  },
                  "then": "failed"
                },
                {
                  "when": {
                    "$eq": [
                      {
                        "$ref": "response.status"
                      },
                      "succeeded"
                    ]
                  },
                  "then": "succeeded"
                },
                {
                  "when": {
                    "$eq": [
                      {
                        "$ref": "response.status"
                      },
                      "failed"
                    ]
                  },
                  "then": "failed"
                }
              ],
              "default": "pending"
            }
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error"
              },
              {
                "$ref": "response.message"
              }
            ]
          },
          "videos": {
            "$ref": "response.results"
          },
          "resultKind": "video",
          "resultEphemeral": true,
          "errorPaths": [
            "error"
          ]
        }
      },
      {
        "id": "grsai-wan-video",
        "label": "Grsai 视频（Wan 3.0）",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://grsaiapi.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "values": [
              "wan-3.0"
            ],
            "mapping": "model",
            "description": "Grsai 视频（Wan 3.0） 仅支持 wan-3.0。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images/firstFrame/lastFrame",
            "description": "参考图或首尾帧，最多 10 张参考图；首尾帧必须成对，且与参考图、参考音频互斥。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "audios",
            "description": "参考音频，最多 5 段。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": true,
            "values": [
              "16:9",
              "9:16",
              "21:9",
              "4:3",
              "1:1",
              "3:4"
            ],
            "mapping": "aspectRatio",
            "description": "画幅比例。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": true,
            "values": [
              "480p",
              "720p",
              "1080p"
            ],
            "mapping": "resolution",
            "description": "分辨率档位。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": true,
            "mapping": "duration",
            "description": "视频时长秒数，2~30 秒。"
          },
          {
            "name": "seed",
            "type": "integer",
            "required": false,
            "mapping": "providerOptions.grsai-wan-video.seed",
            "description": "随机种子，用于复现同一结果。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "厂商扩展字段，按 grsai-wan-video 命名空间透传。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                0
              ]
            },
            "message": "Grsai Wan 3.0 不支持参考视频输入"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "as": "media",
                      "where": {
                        "$not": {
                          "$in": [
                            {
                              "$ref": "media.role"
                            },
                            [
                              "first_frame",
                              "last_frame"
                            ]
                          ]
                        }
                      }
                    }
                  }
                },
                10
              ]
            },
            "message": "Grsai Wan 3.0 最多支持 10 张参考图"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                5
              ]
            },
            "message": "Grsai Wan 3.0 最多支持 5 段参考音频"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "as": "media",
                      "where": {
                        "$eq": [
                          {
                            "$ref": "media.role"
                          },
                          "first_frame"
                        ]
                      }
                    }
                  }
                },
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "as": "media",
                      "where": {
                        "$eq": [
                          {
                            "$ref": "media.role"
                          },
                          "last_frame"
                        ]
                      }
                    }
                  }
                }
              ]
            },
            "message": "Grsai Wan 3.0 的首帧与尾帧必须同时提供"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$ref": "request.duration"
                    },
                    2
                  ]
                },
                {
                  "$lte": [
                    {
                      "$ref": "request.duration"
                    },
                    30
                  ]
                }
              ]
            },
            "message": "Grsai Wan 3.0 的时长需在 2~30 秒之间"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "wan-3.0"
              ]
            },
            "message": "Grsai 视频（Wan 3.0） 仅支持 wan-3.0，请为该模型选择对应协议"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/api/generate",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "replyType": "async",
            "aspectRatio": {
              "$omitEmpty": {
                "$ref": "request.aspectRatio"
              }
            },
            "resolution": {
              "$omitEmpty": {
                "$ref": "request.resolution"
              }
            },
            "duration": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$ref": "request.duration"
                    },
                    0
                  ]
                },
                "then": {
                  "$ref": "request.duration"
                },
                "else": null
              }
            },
            "seed": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$ref": "request.providerOptions.grsai-wan-video.seed"
                    },
                    0
                  ]
                },
                "then": {
                  "$ref": "request.providerOptions.grsai-wan-video.seed"
                },
                "else": null
              }
            },
            "images": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$len": {
                          "$filter": {
                            "from": {
                              "$sortByOrder": {
                                "$ref": "request.images"
                              }
                            },
                            "as": "media",
                            "where": {
                              "$in": [
                                {
                                  "$ref": "media.role"
                                },
                                [
                                  "first_frame",
                                  "last_frame"
                                ]
                              ]
                            }
                          }
                        }
                      },
                      0
                    ]
                  },
                  "then": {
                    "$map": {
                      "from": {
                        "$filter": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "where": {
                            "$not": {
                              "$in": [
                                {
                                  "$ref": "media.role"
                                },
                                [
                                  "first_frame",
                                  "last_frame"
                                ]
                              ]
                            }
                          }
                        }
                      },
                      "as": "media",
                      "in": {
                        "$ref": "media.value"
                      }
                    }
                  },
                  "else": null
                }
              }
            },
            "audios": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$len": {
                          "$filter": {
                            "from": {
                              "$sortByOrder": {
                                "$ref": "request.images"
                              }
                            },
                            "as": "media",
                            "where": {
                              "$in": [
                                {
                                  "$ref": "media.role"
                                },
                                [
                                  "first_frame",
                                  "last_frame"
                                ]
                              ]
                            }
                          }
                        }
                      },
                      0
                    ]
                  },
                  "then": {
                    "$map": {
                      "from": {
                        "$ref": "request.audios"
                      },
                      "as": "media",
                      "in": {
                        "$ref": "media.value"
                      }
                    }
                  },
                  "else": null
                }
              }
            },
            "firstFrame": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "media.role"
                              },
                              "first_frame"
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                "then": {
                  "$first": {
                    "$map": {
                      "from": {
                        "$filter": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "media.role"
                              },
                              "first_frame"
                            ]
                          }
                        }
                      },
                      "as": "media",
                      "in": {
                        "$ref": "media.value"
                      }
                    }
                  }
                },
                "else": null
              }
            },
            "lastFrame": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "media.role"
                              },
                              "last_frame"
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                "then": {
                  "$first": {
                    "$map": {
                      "from": {
                        "$filter": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "media.role"
                              },
                              "last_frame"
                            ]
                          }
                        }
                      },
                      "as": "media",
                      "in": {
                        "$ref": "media.value"
                      }
                    }
                  }
                },
                "else": null
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/api/result",
          "contentType": "application/json",
          "query": {
            "id": {
              "$ref": "taskId"
            }
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$switch": {
              "cases": [
                {
                  "when": {
                    "$eq": [
                      {
                        "$ref": "response.status"
                      },
                      "running"
                    ]
                  },
                  "then": "processing"
                },
                {
                  "when": {
                    "$eq": [
                      {
                        "$ref": "response.status"
                      },
                      "violation"
                    ]
                  },
                  "then": "failed"
                },
                {
                  "when": {
                    "$eq": [
                      {
                        "$ref": "response.status"
                      },
                      "succeeded"
                    ]
                  },
                  "then": "succeeded"
                },
                {
                  "when": {
                    "$eq": [
                      {
                        "$ref": "response.status"
                      },
                      "failed"
                    ]
                  },
                  "then": "failed"
                }
              ],
              "default": "pending"
            }
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error"
              },
              {
                "$ref": "response.message"
              }
            ]
          },
          "videos": {
            "$ref": "response.results"
          },
          "resultKind": "video",
          "resultEphemeral": true,
          "errorPaths": [
            "error"
          ]
        }
      },
      {
        "id": "grsai-agnes-video",
        "label": "Grsai 视频（Agnes 2.5）",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://grsaiapi.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "values": [
              "agnes-video-2.5"
            ],
            "mapping": "model",
            "description": "Grsai 视频（Agnes 2.5） 仅支持 agnes-video-2.5。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images/firstFrame/lastFrame",
            "description": "参考图或首尾帧，最多 5 张参考图；首尾帧必须成对，且与参考图、参考音频互斥。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "audios",
            "description": "参考音频，最多 3 段。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": true,
            "values": [
              "16:9",
              "9:16",
              "21:9",
              "4:3",
              "1:1",
              "3:4"
            ],
            "mapping": "aspectRatio",
            "description": "画幅比例。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": true,
            "values": [
              "720p",
              "1080p",
              "2k"
            ],
            "mapping": "resolution",
            "description": "分辨率档位。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": true,
            "mapping": "duration",
            "description": "视频时长秒数，4~12 秒。"
          },
          {
            "name": "seed",
            "type": "integer",
            "required": false,
            "mapping": "providerOptions.grsai-agnes-video.seed",
            "description": "随机种子，用于复现同一结果。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "厂商扩展字段，按 grsai-agnes-video 命名空间透传。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                0
              ]
            },
            "message": "Grsai Agnes 2.5 不支持参考视频输入"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "as": "media",
                      "where": {
                        "$not": {
                          "$in": [
                            {
                              "$ref": "media.role"
                            },
                            [
                              "first_frame",
                              "last_frame"
                            ]
                          ]
                        }
                      }
                    }
                  }
                },
                5
              ]
            },
            "message": "Grsai Agnes 2.5 最多支持 5 张参考图"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                3
              ]
            },
            "message": "Grsai Agnes 2.5 最多支持 3 段参考音频"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "as": "media",
                      "where": {
                        "$eq": [
                          {
                            "$ref": "media.role"
                          },
                          "first_frame"
                        ]
                      }
                    }
                  }
                },
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "as": "media",
                      "where": {
                        "$eq": [
                          {
                            "$ref": "media.role"
                          },
                          "last_frame"
                        ]
                      }
                    }
                  }
                }
              ]
            },
            "message": "Grsai Agnes 2.5 的首帧与尾帧必须同时提供"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$ref": "request.duration"
                    },
                    4
                  ]
                },
                {
                  "$lte": [
                    {
                      "$ref": "request.duration"
                    },
                    12
                  ]
                }
              ]
            },
            "message": "Grsai Agnes 2.5 的时长需在 4~12 秒之间"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "agnes-video-2.5"
              ]
            },
            "message": "Grsai 视频（Agnes 2.5） 仅支持 agnes-video-2.5，请为该模型选择对应协议"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/api/generate",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "replyType": "async",
            "aspectRatio": {
              "$omitEmpty": {
                "$ref": "request.aspectRatio"
              }
            },
            "resolution": {
              "$omitEmpty": {
                "$ref": "request.resolution"
              }
            },
            "duration": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$ref": "request.duration"
                    },
                    0
                  ]
                },
                "then": {
                  "$ref": "request.duration"
                },
                "else": null
              }
            },
            "seed": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$ref": "request.providerOptions.grsai-agnes-video.seed"
                    },
                    0
                  ]
                },
                "then": {
                  "$ref": "request.providerOptions.grsai-agnes-video.seed"
                },
                "else": null
              }
            },
            "images": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$len": {
                          "$filter": {
                            "from": {
                              "$sortByOrder": {
                                "$ref": "request.images"
                              }
                            },
                            "as": "media",
                            "where": {
                              "$in": [
                                {
                                  "$ref": "media.role"
                                },
                                [
                                  "first_frame",
                                  "last_frame"
                                ]
                              ]
                            }
                          }
                        }
                      },
                      0
                    ]
                  },
                  "then": {
                    "$map": {
                      "from": {
                        "$filter": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "where": {
                            "$not": {
                              "$in": [
                                {
                                  "$ref": "media.role"
                                },
                                [
                                  "first_frame",
                                  "last_frame"
                                ]
                              ]
                            }
                          }
                        }
                      },
                      "as": "media",
                      "in": {
                        "$ref": "media.value"
                      }
                    }
                  },
                  "else": null
                }
              }
            },
            "audios": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$len": {
                          "$filter": {
                            "from": {
                              "$sortByOrder": {
                                "$ref": "request.images"
                              }
                            },
                            "as": "media",
                            "where": {
                              "$in": [
                                {
                                  "$ref": "media.role"
                                },
                                [
                                  "first_frame",
                                  "last_frame"
                                ]
                              ]
                            }
                          }
                        }
                      },
                      0
                    ]
                  },
                  "then": {
                    "$map": {
                      "from": {
                        "$ref": "request.audios"
                      },
                      "as": "media",
                      "in": {
                        "$ref": "media.value"
                      }
                    }
                  },
                  "else": null
                }
              }
            },
            "firstFrame": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "media.role"
                              },
                              "first_frame"
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                "then": {
                  "$first": {
                    "$map": {
                      "from": {
                        "$filter": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "media.role"
                              },
                              "first_frame"
                            ]
                          }
                        }
                      },
                      "as": "media",
                      "in": {
                        "$ref": "media.value"
                      }
                    }
                  }
                },
                "else": null
              }
            },
            "lastFrame": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "media.role"
                              },
                              "last_frame"
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                "then": {
                  "$first": {
                    "$map": {
                      "from": {
                        "$filter": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "media.role"
                              },
                              "last_frame"
                            ]
                          }
                        }
                      },
                      "as": "media",
                      "in": {
                        "$ref": "media.value"
                      }
                    }
                  }
                },
                "else": null
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/api/result",
          "contentType": "application/json",
          "query": {
            "id": {
              "$ref": "taskId"
            }
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$switch": {
              "cases": [
                {
                  "when": {
                    "$eq": [
                      {
                        "$ref": "response.status"
                      },
                      "running"
                    ]
                  },
                  "then": "processing"
                },
                {
                  "when": {
                    "$eq": [
                      {
                        "$ref": "response.status"
                      },
                      "violation"
                    ]
                  },
                  "then": "failed"
                },
                {
                  "when": {
                    "$eq": [
                      {
                        "$ref": "response.status"
                      },
                      "succeeded"
                    ]
                  },
                  "then": "succeeded"
                },
                {
                  "when": {
                    "$eq": [
                      {
                        "$ref": "response.status"
                      },
                      "failed"
                    ]
                  },
                  "then": "failed"
                }
              ],
              "default": "pending"
            }
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error"
              },
              {
                "$ref": "response.message"
              }
            ]
          },
          "videos": {
            "$ref": "response.results"
          },
          "resultKind": "video",
          "resultEphemeral": true,
          "errorPaths": [
            "error"
          ]
        }
      },
      {
        "id": "grsai-image",
        "label": "Grsai 图片",
        "capabilities": [
          "image"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://grsaiapi.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "图片模型 ID，nano-banana 系列或 gpt-image 系列。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "图片提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images",
            "description": "参考图，支持 URL 与 Base64。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspectRatio",
            "description": "画幅比例或像素尺寸；nano-banana 用 1:1、16:9 等比例，gpt-image 的 vip / flare / sunburst 系列只接受 1024x1024 这类像素值。"
          },
          {
            "name": "imageSize",
            "type": "string",
            "required": false,
            "values": [
              "1K",
              "2K",
              "4K"
            ],
            "mapping": "providerOptions.grsai-image.imageSize",
            "description": "nano-banana 系列的分辨率档位。"
          },
          {
            "name": "quality",
            "type": "string",
            "required": false,
            "values": [
              "auto",
              "low",
              "medium",
              "high",
              "xhigh",
              "max"
            ],
            "mapping": "providerOptions.grsai-image.quality",
            "description": "gpt-image 系列的质量档位，按模型支持情况选择。"
          },
          {
            "name": "background",
            "type": "string",
            "required": false,
            "values": [
              "transparent"
            ],
            "mapping": "providerOptions.grsai-image.background",
            "description": "背景参数，transparent 表示透明背景。"
          },
          {
            "name": "outputFormat",
            "type": "string",
            "required": false,
            "values": [
              "png",
              "gif",
              "svg"
            ],
            "mapping": "providerOptions.grsai-image.outputFormat",
            "description": "返回图片格式；gif 与 svg 仅部分 gpt-image 模型支持。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "厂商扩展字段，按 grsai-image 命名空间透传。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                0
              ]
            },
            "message": "Grsai 图片不支持参考视频输入"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                0
              ]
            },
            "message": "Grsai 图片不支持参考音频输入"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/api/generate",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "replyType": "async",
            "aspectRatio": {
              "$omitEmpty": {
                "$ref": "request.aspectRatio"
              }
            },
            "images": {
              "$map": {
                "from": {
                  "$sortByOrder": {
                    "$ref": "request.images"
                  }
                },
                "as": "media",
                "in": {
                  "$ref": "media.value"
                }
              }
            },
            "imageSize": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.grsai-image.imageSize"
              }
            },
            "quality": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.quality"
                  },
                  {
                    "$ref": "request.providerOptions.grsai-image.quality"
                  }
                ]
              }
            },
            "background": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.grsai-image.background"
              }
            },
            "outputFormat": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.grsai-image.outputFormat"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/api/result",
          "contentType": "application/json",
          "query": {
            "id": {
              "$ref": "taskId"
            }
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$switch": {
              "cases": [
                {
                  "when": {
                    "$eq": [
                      {
                        "$ref": "response.status"
                      },
                      "running"
                    ]
                  },
                  "then": "processing"
                },
                {
                  "when": {
                    "$eq": [
                      {
                        "$ref": "response.status"
                      },
                      "violation"
                    ]
                  },
                  "then": "failed"
                },
                {
                  "when": {
                    "$eq": [
                      {
                        "$ref": "response.status"
                      },
                      "succeeded"
                    ]
                  },
                  "then": "succeeded"
                },
                {
                  "when": {
                    "$eq": [
                      {
                        "$ref": "response.status"
                      },
                      "failed"
                    ]
                  },
                  "then": "failed"
                }
              ],
              "default": "pending"
            }
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error"
              },
              {
                "$ref": "response.message"
              }
            ]
          },
          "images": {
            "$ref": "response.results"
          },
          "resultKind": "image",
          "resultEphemeral": true,
          "errorPaths": [
            "error"
          ]
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
