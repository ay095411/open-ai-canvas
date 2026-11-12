# 算力AI 视频接口字段

## 协议身份

- 插件 ID：`suanliai`。
- Provider ID：`suanliai-video`。
- 能力：`video`。
- 默认 Base URL：`https://suanliai.top`。
- 鉴权驱动：`bearer`。
- 创建：`POST /v1/videos`。
- 查询：`GET /v1/videos/{{taskId}}`。
- 生命周期：异步任务轮询（提交只代表受理，终态以轮询结果为准）。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | 算力AI API Key，在控制台「API 密钥」页创建，形如 `sk-...`。 |

## 为什么一个协议覆盖全部视频模型

算力AI 把各家视频模型统一成一套字段，并对参数做**自动收敛**，所以协议层不按模型拆：

- 分辨率档位不支持时收敛到该模型主档（`720P`、`1080p` 大小写由网关归一），不报错。
- 时长不在允许档位时就近吸附（传 4 秒按 5 秒、传 35 秒按 30 秒），不报错。
- 参考图/视频/音频字段名由网关按模型改写（`image_urls`、`reference_images` 等都识别），客户端只写 `images` / `videos` / `audios`。
- 模型名本身就是唯一真相源，取值必须来自 `GET /v1/models`；文档里带括号的中文名是展示名，任务记录里的「内部名称」不能照抄提交。

因此模型差异不需要新协议，只需要在渠道模型里填对 `model`。唯一需要客户端让路的是**模型自身的硬上限**：不同模型参考图上限 3 / 9 / 10 / 30 张、参考音频 0 / 3 / 10 段不等，超限会被网关或模型服务拒绝（不扣费），提示为中文。

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 上游模型名，必须来自 `/v1/models`。 |
| `prompt` | string | 否 | `prompt` | 视频提示词；多数模型必填，画质增强类模型可不传。提示词里可用 `@图片N` 指代第 N 张参考图。 |
| `images` | media[] | 否 | `images` | 参考图或首尾帧，按画布顺序提交；`mask` 角色不下发。上限以模型为准，全站最宽 30 张。 |
| `videos` | media[] | 否 | `videos` | 参考视频。部分模型不支持（如高质量特惠 sd2.5），传了会 400。 |
| `audios` | media[] | 否 | `audios` | 参考音频。单独提交音频而不带图/视频会被拒绝。 |
| `duration` | integer | 否 | `seconds` | 时长秒数；不传按模型默认档（常见 15 或 5 秒）。 |
| `aspectRatio` | string | 否 | `aspect_ratio` | 画幅比例，如 `16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`21:9`。 |
| `resolution` | string | 否 | `resolution` | 清晰度档位：`480p` / `720p` / `768p` / `1080p` / `2k` / `4k`，大小写不敏感。 |
| `generateAudio` | boolean | 否 | `generate_audio` | 是否生成带声音的视频；仅音频能力模型生效，其余自动忽略。 |
| `watermark` | boolean | 否 | `watermark` | 水印开关；仅支持的模型生效。 |
| `seed` | integer | 否 | `seed` | 随机种子，走 `providerOptions.suanliai-video.seed`，0 或缺省不下发。 |
| `providerOptions` | object | 否 | `provider-specific fields` | 厂商扩展字段命名空间 `suanliai-video`。 |

## 上游请求模板逐字段清单

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/videos"` |
| `create.originPath` | `true`：Base URL 填 `https://suanliai.top` 或 `https://suanliai.top/v1` 都能命中同一路径 |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.prompt` | `{"$omitEmpty":{"$ref":"request.prompt"}}` |
| `create.body.images` | 按 `order` 排序、剔除 `mask` 角色后的 `media.value` 数组 |
| `create.body.videos` | 按 `order` 排序后的 `media.value` 数组 |
| `create.body.audios` | 按 `order` 排序后的 `media.value` 数组 |
| `create.body.seconds` | `duration > 0` 时下发 `request.duration`，否则省略 |
| `create.body.aspect_ratio` | `{"$omitEmpty":{"$ref":"request.aspectRatio"}}` |
| `create.body.resolution` | `{"$omitEmpty":{"$ref":"request.resolution"}}` |
| `create.body.generate_audio` | 仅在请求为真时下发 `true` |
| `create.body.watermark` | 仅在请求为真时下发 `true` |
| `create.body.seed` | `providerOptions.suanliai-video.seed > 0` 时下发 |
| `poll.method` | `"GET"` |
| `poll.path` | `"/v1/videos/{{taskId}}"` |

## Provider 扩展键

- `providerOptions.suanliai-video.seed`

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `$coalesce(response.task_id, response.id, taskId)` |
| `response.status` | `response.status`：`queued`→pending、`in_progress`→processing、`completed`→succeeded、`failed`/`cancelled` 各自归一 |
| `response.message` | `$coalesce(response.message, response.error.message, response.error, response.fail_reason)` |
| `response.stage` | `response.delivery_status`（`archiving`、`local_ready`，仅用于进度展示） |
| `response.videos` | `$coalesce(response.video_url, response.url, response.result_url, response.download_url, response.metadata.url)` |
| `response.usage` | `response.usage` |
| `response.resultEphemeral` | `true`：成片是带 `expires` 签名的临时直链，宿主必须立即下载落盘 |
| `response.errorPaths[0]` | `"error"` |

## 生命周期与超时

- 提交返回 `{ "id": "...", "task_id": "...", "status": "queued", "progress": 0 }`，`status` 依次为 `queued` → `in_progress` → `completed` / `failed`。
- 实测 10 秒 768P 任务约 6 分钟出片（含 `delivery_status=archiving` 阶段）；常规视频任务建议轮询间隔 10–15 秒，长队列模型可拉长到 30 秒。
- 成片地址在 `completed` 时一次性给出，`expires` 约 24 小时；宿主按 `resultEphemeral` 立即下载。
- 网关没有对外暴露取消接口（`POST /v1/videos/{id}/cancel` 返回 404），因此本协议不声明 `cancel`。

## 计费与失败语义

- 三种口径：按次（如 `专享`、`高质量特惠`）、按秒（如 `稳定官渠`、`按秒特惠`）、按量（`火山官方` 系列按 token）。
- 按量模型提交时按估算预扣，出片后按实际用量多退少补。
- 任务判定失败即时全额退回预扣；提交阶段被拦（余额不足、参考图不可用、参数不符、`@图片N` 越界）本就不扣费。
- 带参考视频的请求走「有参考视频」单价，比纯文生/图生视频贵，价格在渠道模型价格档里按分辨率设置。

## 常见错误

| 现象 | 原因与处理 |
| --- | --- |
| `503` `fail_to_fetch_task` | 网关侧临时异常（不扣费）。换模型重试或稍后再试；偶发单模型故障时换同档其它模型。 |
| 「参考图必须是 1–9 张」 | 模型没收到可用参考图：多半是省了 `images`，或链接不可公网访问。 |
| 「参考图最多 N 张」 | 图收到了但超该模型上限，按模型能力表减量。 |
| 「提示词里引用了 @图片N，但本次只传了 M 张」 | 提示词最大序号必须 ≤ 实际传图数。 |
| 「该模型（…）不支持参考视频」 | 去掉 `videos`，需要运镜就把镜头运动写进 `prompt`。 |
| 「该模型不支持参考音频」 | 去掉 `audios`。 |
| 「请求未被接受，请检查模型、参数和输入内容」 | 提示词过长（部分模型约 5900 字上限）或素材超限；按顺序自查后重试。 |
| 「task_not_exist」 | 任务 ID 不存在或已过期，重新提交，不要反复轮询同一 ID。 |

## 兼容边界

该包只代表算力AI 的 `/v1/videos` 线协议。同一个 Base URL 下的图片、对话能力属于各自标准线格式，用现有通用协议接入，不要用本协议转发；站点上的 MJ 生图属于图片能力，也不在本协议范围内。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "suanliai",
  "name": "算力AI",
  "version": "1.0.0",
  "author": "算力AI / 影策",
  "description": "算力AI 视频生成协议插件：一个协议覆盖站内全部视频模型（OpenAI /v1/videos 异步任务）。",
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
        "id": "suanliai-video",
        "label": "算力AI 视频",
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
        "baseUrl": "https://suanliai.top",
        "requiresPublicMediaUrls": true,
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
            "description": "上游视频模型名，必须来自 GET /v1/models（如 官方直连1区-SD2.5-满血稳定高速、稳定高速sd2.5(30参任选/4-30秒/720P)）。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": false,
            "mapping": "prompt",
            "description": "视频提示词。多数模型必填；画质增强类模型可不传。可用 @图片N 指代第 N 张参考图。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "first/last/reference image",
            "description": "参考图或首尾帧，按画布顺序下发为 images 数组；上限以模型为准（3 / 9 / 10 / 30 张不等）。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "reference video",
            "description": "参考视频，下发为 videos 数组；部分模型不支持。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "reference audio",
            "description": "参考音频，下发为 audios 数组；不能脱离图片或参考视频单独提交。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "seconds",
            "description": "时长秒数。各模型只接受固定档或区间，网关会自动就近吸附，不会因超范围失败。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspect_ratio",
            "description": "画幅比例：16:9、9:16、1:1、4:3、3:4、21:9。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "清晰度档位：480p、720p、768p、1080p、2k、4k；大小写不敏感，不支持的档位会收敛到主档。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "generate_audio",
            "description": "是否生成带声音的视频；仅音频能力模型生效。"
          },
          {
            "name": "watermark",
            "type": "boolean",
            "required": false,
            "mapping": "watermark",
            "description": "水印开关；仅支持的模型生效。"
          },
          {
            "name": "seed",
            "type": "integer",
            "required": false,
            "mapping": "providerOptions.suanliai-video.seed",
            "description": "随机种子，用于复现同一结果；0 或缺省不下发。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "厂商扩展字段，按 suanliai-video 命名空间透传。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$len": {
                        "$ref": "request.audios"
                      }
                    },
                    0
                  ]
                },
                {
                  "$gt": [
                    {
                      "$len": {
                        "$ref": "request.images"
                      }
                    },
                    0
                  ]
                },
                {
                  "$gt": [
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    },
                    0
                  ]
                }
              ]
            },
            "message": "算力AI 不接受只带参考音频的请求：请同时提供至少一张参考图或一段参考视频"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                30
              ]
            },
            "message": "算力AI 单个任务最多 30 张参考图，且多数模型上限更低（3 / 9 / 10 张）"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                10
              ]
            },
            "message": "算力AI 单个任务最多 10 段参考视频"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                10
              ]
            },
            "message": "算力AI 单个任务最多 10 段参考音频"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos",
          "originPath": true,
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$omitEmpty": {
                "$ref": "request.prompt"
              }
            },
            "images": {
              "$omitEmpty": {
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
                        "$ne": [
                          {
                            "$ref": "media.role"
                          },
                          "mask"
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
            "videos": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.videos"
                    }
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "audios": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.audios"
                    }
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "seconds": {
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
            "aspect_ratio": {
              "$omitEmpty": {
                "$ref": "request.aspectRatio"
              }
            },
            "resolution": {
              "$omitEmpty": {
                "$ref": "request.resolution"
              }
            },
            "generate_audio": {
              "$if": {
                "condition": {
                  "$ref": "request.generateAudio"
                },
                "then": true,
                "else": null
              }
            },
            "watermark": {
              "$if": {
                "condition": {
                  "$ref": "request.watermark"
                },
                "then": true,
                "else": null
              }
            },
            "seed": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$ref": "request.providerOptions.suanliai-video.seed"
                    },
                    0
                  ]
                },
                "then": {
                  "$ref": "request.providerOptions.suanliai-video.seed"
                },
                "else": null
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}",
          "originPath": true,
          "contentType": "application/json"
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.task_id"
              },
              {
                "$ref": "response.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$ref": "response.status"
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.message"
              },
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.error"
              },
              {
                "$ref": "response.fail_reason"
              }
            ]
          },
          "stage": {
            "$ref": "response.delivery_status"
          },
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.url"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.download_url"
              },
              {
                "$ref": "response.metadata.url"
              }
            ]
          },
          "usage": {
            "$ref": "response.usage"
          },
          "resultKind": "video",
          "resultEphemeral": true,
          "errorPaths": [
            "error"
          ]
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
