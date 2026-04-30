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

export const DEFAULT_PROMPT = [
  "Describe this image in detail and factually. Your description will be read by a coding agent that cannot see the image.",
  "",
  "If this is a screenshot of a UI, webpage, code editor, or terminal:",
  "- Transcribe all visible text, code, error messages, logs, and UI labels verbatim",
  "- Describe the layout, colors, and any visual issues (misalignment, broken elements, error states, unexpected behavior)",
  "- Note the apparent tool, framework, or context (e.g. React app, Chrome DevTools, VS Code)",
  "",
  "If this is a photo, artwork, or image of a person/character:",
  "- Describe appearance, clothing, expression, pose, and setting",
  "- If the subject appears to be a known character, public figure, or recognizable entity, identify them",
  "",
  "If this is a diagram, chart, architecture drawing, or table:",
  "- Describe the structure, labels, relationships, and key data points",
  "",
  "For any other image type, describe all visible elements, text, and context factually.",
].join("\n");

/**
 * Read the persisted visionizer config from session custom entries.
 * Returns undefined if not configured.
 */
export function getConfig(ctx: ExtensionContext): VisionizerConfig | undefined {
  const entries = ctx.sessionManager.getEntries();
  // Iterate in reverse — newest config entry wins. appendEntry() adds
  // entries to the end, so the last matching entry is the current config.
  //
  // Cap the search to the last 20 entries to avoid performance degradation
  // in long sessions where config may have been toggled many times.
  const startIdx = Math.max(0, entries.length - 20);
  for (let i = entries.length - 1; i >= startIdx; i--) {
    const entry = entries[i];
    if (entry.type === "custom" && entry.customType === CUSTOM_TYPE) {
      const data = entry.data as VisionizerConfig | undefined;
      if (data?.provider && data?.modelId) {
        return data;
      }
      // A null/empty entry from /visionizer-clear → stop searching;
      // anything before it is stale.
      if (data === null || data === undefined) {
        return undefined;
      }
    }
  }
  return undefined;
}
