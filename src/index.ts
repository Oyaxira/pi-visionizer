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

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { registerCommands } from "./commands";
import {
  CUSTOM_TYPE,
  DEFAULT_PROMPT,
  getConfig,
  type VisionizerConfig,
} from "./config";
import {
  clearCache,
  describeImage,
  getCached,
  setCache,
  type VisionCallResult,
} from "./vision-client";

export default function (pi: ExtensionAPI) {
  registerCommands(pi);

  // ── Context hook: fired before every LLM call ──
  pi.on("context", async (event, ctx) => {
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

    // Process messages: replace image blocks with text descriptions
    const processed = await processMessages(
      event.messages,
      visionModel,
      auth.apiKey,
      prompt,
    );

    return { messages: processed };
  });
}

// ── Helpers ──

/**
 * Check if any message in the array contains image content blocks.
 */
function hasImages(messages: readonly AgentMessage[]): boolean {
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
  messages: readonly AgentMessage[],
  visionModel: ReturnType<ExtensionContext["modelRegistry"]["find"]>,
  apiKey: string,
  prompt: string,
): Promise<AgentMessage[]> {
  const result: AgentMessage[] = [];

  for (const msg of messages) {
    if (!Array.isArray(msg.content)) {
      result.push(msg as AgentMessage);
      continue;
    }

    const newContent: any[] = [];
    let hasReplacement = false;

    for (const block of msg.content) {
      if (isImageBlock(block)) {
        hasReplacement = true;

        const imgKey = cacheKey(block.data, block.mimeType ?? "image/png");
        let description = getCached(imgKey);

        if (!description) {
          const visionResult = await describeImage({
            imageBase64: block.data,
            mediaType: block.mimeType ?? "image/png",
            model: visionModel as any,
            apiKey,
            prompt,
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
      } else {
        newContent.push(block);
      }
    }

    if (hasReplacement) {
      result.push({ ...msg, content: newContent } as AgentMessage);
    } else {
      result.push(msg as AgentMessage);
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
 * Generate a cache key from image data.
 */
function cacheKey(data: string, mimeType: string): string {
  const len = data.length;
  return data.slice(0, 64) + ":" + mimeType + ":" + len + ":" + data.slice(-64);
}
