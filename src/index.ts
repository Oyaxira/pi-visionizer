/**
 * pi-visionizer — Add vision support to any text-only model in pi.
 *
 * When enabled, transparently proxys image content through a configured
 * vision model. Text-only models (like DeepSeek V4) receive text descriptions
 * instead of raw image data.
 *
 * ## How it works
 *
 * 1. Intercept the `context` event (fires before every LLM call)
 * 2. Check: is the current model text-only AND is visionizer configured?
 * 3. Scan messages for image content blocks (from user paste or tool results)
 * 4. Send images to configured vision model via direct API call
 * 5. Replace image blocks with `[Image Description: ...]` text
 * 6. Return text-only messages — the LLM never sees raw images
 *
 * ## Reliability
 *
 * - Does NOT modify pi's model registry or provider config
 * - Does NOT affect native vision models (claude, gpt-4o, etc.)
 * - Unconfigured → completely transparent, zero overhead
 * - Errors from vision model → replaces image with error note, never blocks
 */

import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerCommands } from "./commands.ts";
import { DEFAULT_PROMPT, resolveConfig } from "./config.ts";
import {
  describeImage,
  getCached,
  setCache,
  type VisionModelInfo,
} from "./vision-client.ts";

const DESCRIBE_IMAGE_TOOL_NAME = "describe_image";

interface ModelWithInput {
  input: readonly string[];
}

export default function (pi: ExtensionAPI) {
  registerCommands(pi);

  // The tool remains registered so it can be restored after a model switch,
  // but native vision models should never see its schema or prompt guidance.
  let describeImageToolTemporarilyHidden = false;

  const setDescribeImageToolActive = (active: boolean): boolean => {
    const activeTools = pi.getActiveTools();
    const isActive = activeTools.includes(DESCRIBE_IMAGE_TOOL_NAME);
    if (isActive === active) return true;

    if (active) {
      // Respect --exclude-tools and other configurations that remove the tool
      // from the registry entirely.
      const isAvailable = pi.getAllTools().some(
        (tool) => tool.name === DESCRIBE_IMAGE_TOOL_NAME,
      );
      if (!isAvailable) return false;
      pi.setActiveTools([...activeTools, DESCRIBE_IMAGE_TOOL_NAME]);
    } else {
      pi.setActiveTools(
        activeTools.filter((name) => name !== DESCRIBE_IMAGE_TOOL_NAME),
      );
    }

    return true;
  };

  const syncDescribeImageTool = (model: ModelWithInput | undefined): void => {
    if (!model) return;

    if (model.input.includes("image")) {
      if (pi.getActiveTools().includes(DESCRIBE_IMAGE_TOOL_NAME)) {
        describeImageToolTemporarilyHidden = true;
        setDescribeImageToolActive(false);
      }
      return;
    }

    if (
      describeImageToolTemporarilyHidden &&
      setDescribeImageToolActive(true)
    ) {
      describeImageToolTemporarilyHidden = false;
    }
  };

  // ── Tool: describe_image — LLM can actively call this ──
  pi.registerTool({
    name: DESCRIBE_IMAGE_TOOL_NAME,
    label: "Describe Image",
    description:
      "Describe an image file using the configured vision model. " +
      "Use this to understand screenshots, diagrams, photos, or any image content. " +
      "This is especially useful when you need to know what's in an image file on disk.",
    promptSnippet: "Describe an image file using a vision model",
    promptGuidelines: [
      "Use describe_image when you need to understand the content of an image file on disk (screenshots, diagrams, photos, etc.).",
    ],
    parameters: Type.Object({
      path: Type.String({
        description: "Path to the image file to describe (e.g. screenshot.png, diagram.jpg)",
      }),
      prompt: Type.Optional(
        Type.String({
          description:
            "Custom prompt for the vision model. If omitted, uses the default description prompt.",
        }),
      ),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      const absPath = path.resolve(ctx.cwd, params.path);

      // Check file size before reading (prevent OOM / API rejection on huge images)
      let stat: { size: number };
      try {
        stat = await fs.stat(absPath);
      } catch (err: any) {
        const msg = err?.code === "ENOENT"
          ? `Image file not found: ${params.path}`
          : `Failed to stat image: ${err.message ?? err}`;
        throw new Error(msg);
      }

      const MAX_SIZE = 4 * 1024 * 1024; // 4 MB — safe for all vision APIs, keeps requests fast
      if (stat.size > MAX_SIZE) {
        const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
        throw new Error(
          `Image too large: ${sizeMB} MB (limit: 4 MB).\n` +
            `Compress it first, e.g.:\n` +
            `  - convert input.png -resize 2048x2048\> -quality 85 output.jpg\n` +
            `  - mogrify -resize 2048x2048\> -quality 85 *.png`,
        );
      }

      // Read image file
      let buffer: Buffer;
      try {
        buffer = await fs.readFile(absPath);
      } catch (err: any) {
        throw new Error(`Failed to read image: ${err.message ?? err}`);
      }

      // Determine MIME type from extension
      const ext = path.extname(params.path).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".bmp": "image/bmp",
      };
      const mediaType = mimeMap[ext] ?? "image/png";
      const imageBase64 = buffer.toString("base64");

      // Resolve vision model config (session or hardcoded default)
      const cfg = resolveConfig(ctx);
      const visionModel = ctx.modelRegistry.find(cfg.provider, cfg.modelId);
      if (!visionModel) {
        throw new Error(
          `Vision model ${cfg.provider}/${cfg.modelId} not found in model registry.`,
        );
      }

      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(visionModel);
      if (!auth.ok) {
        throw new Error(`Vision model API key not available: ${auth.error}`);
      }
      if (!auth.apiKey) {
        throw new Error("Vision model API key not available.");
      }

      onUpdate?.({
        content: [{ type: "text", text: "Describing image…" }],
        details: {},
      });

      const result = await describeImage({
        imageBase64,
        mediaType,
        model: visionModel as VisionModelInfo,
        apiKey: auth.apiKey,
        prompt: params.prompt || cfg.prompt || DEFAULT_PROMPT,
        requireHttps: cfg.requireHttps !== false,
      });

      if (result.error && !result.description) {
        throw new Error(`Failed to describe image: ${result.error}`);
      }

      return {
        content: [{ type: "text", text: result.description || "(no description returned)" }],
        details: { path: params.path, mediaType, size: buffer.length },
      };
    },
  });

  // Keep describe_image out of native vision models' active tool set. This
  // removes its schema, prompt snippet, and guidelines from model context.
  pi.on("session_start", (_event, ctx) => {
    syncDescribeImageTool(ctx.model);
  });

  pi.on("model_select", (event) => {
    syncDescribeImageTool(event.model);
  });

  // Undo our temporary change before reload/session replacement. The next
  // extension instance will hide the tool again if the selected model still
  // supports images, while text-only models get the original tool state back.
  pi.on("session_shutdown", () => {
    if (
      describeImageToolTemporarilyHidden &&
      setDescribeImageToolActive(true)
    ) {
      describeImageToolTemporarilyHidden = false;
    }
  });

  // ── Context hook: fired before every LLM call ──
  pi.on("context", async (event, ctx) => {
    try {
      // Skip if current model supports images natively
      const model = ctx.model;
      if (!model || model.input.includes("image")) return;

      // Resolve config (session entry or hardcoded default)
      const cfg = resolveConfig(ctx);

      // Find the vision model in pi's registry
      const visionModel = ctx.modelRegistry.find(cfg.provider, cfg.modelId);
      if (!visionModel) return;

      // Check for image content in messages
      if (!hasImages(event.messages)) return;

      // Resolve vision model auth
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(visionModel);
      if (!auth.ok || !auth.apiKey) return;

      const prompt = cfg.prompt || DEFAULT_PROMPT;
      const requireHttps = cfg.requireHttps !== false; // default true

      // Process messages: replace image blocks with text descriptions
      const processed = await processMessages(
        event.messages,
        visionModel,
        auth.apiKey,
        prompt,
        requireHttps,
      );

      return { messages: processed };
    } catch {
      // Silently pass through — never block the conversation
      return;
    }
  });
}

// ── Helpers ──

/** Message type exposed by pi's context event. */
type ContextMessage = ContextEvent["messages"][number];

/**
 * Check if any message in the array contains image content blocks.
 */
function hasImages(messages: readonly ContextMessage[]): boolean {
  for (const msg of messages) {
    if (
      msg.role !== "user" &&
      msg.role !== "toolResult" &&
      msg.role !== "custom"
    ) continue;
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (isImageBlock(block)) return true;
    }
  }
  return false;
}

/**
 * Process all messages: replace image blocks with text descriptions.
 */
async function processMessages(
  messages: readonly ContextMessage[],
  visionModel: VisionModelInfo,
  apiKey: string,
  prompt: string,
  requireHttps: boolean,
): Promise<ContextMessage[]> {
  const result: ContextMessage[] = [];

  for (const msg of messages) {
    if (
      msg.role !== "user" &&
      msg.role !== "toolResult" &&
      msg.role !== "custom"
    ) {
      result.push(msg);
      continue;
    }
    if (!Array.isArray(msg.content)) {
      result.push(msg);
      continue;
    }

    const newContent: typeof msg.content = [];
    let hasReplacement = false;

    for (const block of msg.content) {
      if (isImageBlock(block)) {
        hasReplacement = true;

        const mimeType = (block as any).mimeType ?? "image/png";
        const imgKey = cacheKey(block.data, mimeType);
        let description = getCached(imgKey);

        if (!description) {
          const visionResult = await describeImage({
            imageBase64: block.data,
            mediaType: mimeType,
            model: visionModel,
            apiKey,
            prompt,
            requireHttps,
          });

          if (visionResult.error && !visionResult.description) {
            description = `[Image: unable to describe — ${visionResult.error}]`;
          } else {
            description = visionResult.description || "[Image: no description returned]";
            setCache(imgKey, description);
          }
        }

        newContent.push({
          type: "text",
          text: `[Image Description: ${description}]`,
        });
      } else if (isTextBlock(block)) {
        // Clean misleading notes added by pi's read tool for text-only models.
        // Since we ARE providing an image description, remove the note.
        newContent.push({
          type: "text",
          text: stripNoVisionNote(block.text),
        });
      } else {
        newContent.push(block);
      }
    }

    if (hasReplacement) {
      result.push({ ...msg, content: newContent });
    } else {
      result.push(msg);
    }
  }

  return result;
}

/**
 * Type guard: check if a content block is an image.
 */
function isImageBlock(block: unknown): block is { type: "image"; data: string; mimeType?: string } {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as any).type === "image" &&
    typeof (block as any).data === "string"
  );
}

/**
 * Type guard: check if a content block is text.
 */
function isTextBlock(block: unknown): block is { type: "text"; text: string } {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as any).type === "text" &&
    typeof (block as any).text === "string"
  );
}

/**
 * Strip the "model does not support images" note from text content.
 * Since pi-visionizer IS providing a description, this note is misleading.
 * Uses substring matching to avoid breakage if pi changes the exact wording.
 */
function stripNoVisionNote(text: string): string {
  const MARKER = "model does not support images";
  return text
    .split("\n")
    .filter((line) => !line.includes(MARKER))
    .join("\n");
}

/**
 * Generate a cache key from image data.
 * For small images (less than 128 base64 chars), use the full string to
 * avoid collisions that could occur when first/last 64 chars overlap.
 */
function cacheKey(data: string, mimeType: string): string {
  const len = data.length;
  if (len < 128) {
    return data + ":" + mimeType;
  }
  // Long images: use first 64 + mimeType + length + last 64 as fingerprint
  return data.slice(0, 64) + ":" + mimeType + ":" + len + ":" + data.slice(-64);
}
