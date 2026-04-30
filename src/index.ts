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

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCommands } from "./commands";
import { DEFAULT_PROMPT, getConfig } from "./config";
import { describeImage, getCached, setCache } from "./vision-client";

export default function (pi: ExtensionAPI) {
  registerCommands(pi);

  // ── Context hook: fired before every LLM call ──
  pi.on("context", async (event, ctx) => {
    try {
      // Skip if current model supports images natively
      const model = ctx.model;
      if (!model || model.input.includes("image")) return;

      // Skip if visionizer is not configured
      const cfg = getConfig(ctx);
      if (!cfg) return;

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

/** Internal message type for context event messages. */
interface ContextMessage {
  role: string;
  content: unknown[];
  [key: string]: unknown;
}

/**
 * Check if any message in the array contains image content blocks.
 */
function hasImages(messages: readonly ContextMessage[]): boolean {
  for (const msg of messages) {
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
  visionModel: { id: string; baseUrl: string; api: string; name?: string; provider: string; input: string[]; reasoning: boolean; cost: Record<string, number>; contextWindow: number; maxTokens: number },
  apiKey: string,
  prompt: string,
  requireHttps: boolean,
): Promise<ContextMessage[]> {
  const result: ContextMessage[] = [];

  for (const msg of messages) {
    if (!Array.isArray(msg.content)) {
      result.push(msg);
      continue;
    }

    const newContent: unknown[] = [];
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
            model: visionModel as any,
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
