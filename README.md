# pi-visionizer

> Add vision support to any text-only model in pi coding agent.

**pi-visionizer** transparently proxys images through a configured vision model, giving text-only models (like DeepSeek V4, Ollama models, etc.) the ability to "see" images.

[中文文档](README.zh-CN.md)

## How it works

```
You paste an image (or tool reads one)
    ↓
pi-visionizer intercepts before the LLM call
    ↓
Sends image to your chosen vision model (GPT-4o, Claude, Gemini…)
    ↓
Replaces image with [Image Description: …]
    ↓
Text-only model receives plain text — no raw images
```

## Quick Start

### 1. Install

```bash
# Project-local (for testing)
pi install ./pi-visionizer -l

# Global (after testing)
pi install ./pi-visionizer
```

### 2. Configure a vision model

In pi, run:

```
/visionizer-model
```

This lists all your available pi models that support images. Pick one (e.g. `openai/gpt-4.1-mini`).

### 3. Use it

Switch to any text-only model (`/model` → `deepseek` → `deepseek-v4-flash`), then paste an image or ask pi to read one. The vision model describes it transparently.

## Commands

| Command | Description |
|---------|-------------|
| `/visionizer-model` | Select which pi model to use for image description |
| `/visionizer-prompt` | Customize the prompt sent to the vision model |
| `/visionizer-https` | Toggle HTTPS requirement for vision endpoint (on by default) |
| `/visionizer-status` | Show current vision model and cache status |
| `/visionizer-clear` | Disable vision proxy |

## Requirements

- **pi coding agent** (any recent version)
- At least one vision-capable model configured in pi (e.g. OpenAI GPT-4o, Anthropic Claude, Google Gemini)
- The vision model must have a valid API key configured in pi (same way you set up any pi model)

No extra API keys needed — pi-visionizer reuses your existing pi model configurations via `ctx.modelRegistry`.

## Supported Vision Model APIs

| API Format | Example Models |
|-----------|---------------|
| `openai-completions` | gpt-4o, gpt-4.1-mini, gpt-4o-mini |
| `anthropic-messages` | claude-sonnet-4-20250514, claude-3.5-haiku |
| `google-generative-ai` | gemini-2.5-flash, gemini-2.5-pro |

## Reliability

- **Zero impact when disabled** — if no vision model is configured, pi-visionizer does nothing
- **Native vision models untouched** — models that already support images (claude, gpt-4o) are skipped
- **Image caching** — identical images are described only once per session
- **Graceful failure** — if the vision model call fails, images are replaced with an error note, never blocking the conversation

## Use Cases

- **DeepSeek V4** — text-only but with 1M context and cheap pricing, now with vision
- **Ollama local models** — llama3, qwen, etc. get vision through a cloud model
- **Any custom text-only provider** — works automatically as long as it's registered in pi

## License

MIT
