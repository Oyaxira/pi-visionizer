# pi-visionizer

> 为 pi coding agent 中的任意纯文本模型添加视觉支持。

**pi-visionizer** 将图片透明代理到一个已配置的视觉模型进行描述，让纯文本模型（如 DeepSeek V4、Ollama 本地模型等）也能"看懂"图片。

[English](README.md)

## 工作原理

```
你粘贴一张图片（或工具读取了图片文件）
    ↓
pi-visionizer 在 LLM 调用前拦截
    ↓
将图片发送给你选择的视觉模型（GPT-4o、Claude、Gemini…）
    ↓
将图片替换为 [Image Description: …] 文本
    ↓
纯文本模型收到纯文本 — 不会看到原始图片数据
```

## 快速开始

### 1. 安装

```bash
# 项目级安装（测试用）
pi install ./pi-visionizer -l

# 全局安装（测试完成后）
pi install ./pi-visionizer
```

### 2. 配置视觉模型

在 pi 中运行：

```
/visionizer-model
```

这会列出 pi 中所有支持图片的已配置模型。选一个（如 `openai/gpt-4.1-mini`）。

### 3. 使用

切换到任意纯文本模型（`/model` → `deepseek` → `deepseek-v4-flash`），然后粘贴图片或让 pi 读取图片文件即可。视觉模型会透明地描述图片内容。

## 命令

| 命令 | 说明 |
|------|------|
| `/visionizer-model` | 选择用哪个 pi 模型做图片描述 |
| `/visionizer-prompt` | 自定义发送给视觉模型的提示词 |
| `/visionizer-status` | 查看当前视觉模型和缓存状态 |
| `/visionizer-clear` | 关闭视觉代理 |

## 系统要求

- **pi coding agent**（任意较新版本）
- pi 中至少配置了一个支持图片的模型（如 OpenAI GPT-4o、Anthropic Claude、Google Gemini）
- 该视觉模型需要在 pi 中配置了有效的 API key（和普通 pi 模型配置方式相同）

**无需额外 API key** — pi-visionizer 通过 `ctx.modelRegistry` 复用 pi 已有的模型配置。

## 支持的视觉模型 API

| API 格式 | 示例模型 |
|----------|---------|
| `openai-completions` | gpt-4o、gpt-4.1-mini、gpt-4o-mini |
| `anthropic-messages` | claude-sonnet-4-20250514、claude-3.5-haiku |
| `google-generative-ai` | gemini-2.5-flash、gemini-2.5-pro |

## 可靠性设计

- **关闭时零影响** — 未配置视觉模型时，pi-visionizer 不执行任何操作
- **不影响原生视觉模型** — 本身支持图片的模型（claude、gpt-4o）直接跳过
- **图片缓存** — 相同图片在一个会话中只描述一次
- **优雅降级** — 视觉模型调用失败时，图片替换为错误提示，不会阻塞对话

## 使用场景

- **DeepSeek V4** — 纯文本但 1M 上下文 + 便宜价格，现在有视觉能力了
- **Ollama 本地模型** — llama3、qwen 等通过云端模型获得视觉能力
- **任意自定义纯文本 provider** — 只要在 pi 中注册过，自动生效

## 许可证

MIT
