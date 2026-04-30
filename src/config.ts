/**
 * Configuration management for pi-visionizer.
 *
 * Persists vision model selection to session custom entries so it survives restarts.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export const CUSTOM_TYPE = "visionizer-config";

export interface VisionizerConfig {
  /** Provider name of the vision model (e.g. "openai", "anthropic"). */
  provider: string;
  /** Model ID of the vision model (e.g. "gpt-4.1-mini", "claude-sonnet-4-20250514"). */
  modelId: string;
  /** Custom prompt sent to the vision model for describing images. */
  prompt?: string;
}

export const DEFAULT_PROMPT =
  "Describe this image in detail. Include any text, code, UI elements, " +
  "error messages, diagrams, or visual context relevant to the task. " +
  "Be factual and thorough.";

/**
 * Read the persisted visionizer config from session custom entries.
 * Returns undefined if not configured.
 */
export function getConfig(ctx: ExtensionContext): VisionizerConfig | undefined {
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "custom" && entry.customType === CUSTOM_TYPE) {
      const data = entry.data as VisionizerConfig | undefined;
      if (data?.provider && data?.modelId) {
        return data;
      }
    }
  }
  return undefined;
}
