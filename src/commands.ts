/**
 * User commands for pi-visionizer.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { clearCache, getCacheSize } from "./vision-client";
import { CUSTOM_TYPE, getConfig, type VisionizerConfig } from "./config";

export function registerCommands(pi: ExtensionAPI): void {
  // /visionizer-model — pick a vision model from available pi models
  pi.registerCommand("visionizer-model", {
    description: "Select a vision model for image description (used by text-only models)",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      const allModels = ctx.modelRegistry.getAvailable();
      const visionModels = allModels.filter(
        (m) => m.input.includes("image"),
      );

      if (visionModels.length === 0) {
        ctx.ui.notify(
          "No vision-capable models configured. Add one via /model or models.json first.",
          "warning",
        );
        return;
      }

      const currentCfg = getConfig(ctx);
      const currentId = currentCfg
        ? `${currentCfg.provider}/${currentCfg.modelId}`
        : undefined;

      const items = visionModels.map((m) => ({
        value: `${m.provider}/${m.id}`,
        label: `${m.provider}/${m.id}`,
        description: m.name ?? m.id,
        detail: m.id === currentCfg?.modelId && m.provider === currentCfg?.provider
          ? "✓ current"
          : undefined,
      }));

      const picked = await ctx.ui.select(
        `Pick a vision model (current: ${currentId ?? "none"}):`,
        items,
      );

      if (!picked) return;

      const [provider, ...rest] = picked.split("/");
      const modelId = rest.join("/");

      const config: VisionizerConfig = {
        provider,
        modelId,
      };

      await pi.appendEntry(CUSTOM_TYPE, config);
      ctx.ui.notify(
        `Vision model set to ${provider}/${modelId}. All text-only models will now proxy images through it.`,
        "success",
      );
    },
  });

  // /visionizer-status — show current configuration
  pi.registerCommand("visionizer-status", {
    description: "Show current visionizer configuration and cache status",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      const cfg = getConfig(ctx);
      if (!cfg) {
        ctx.ui.notify(
          "Visionizer is not configured. Use /visionizer-model to select a vision model.",
          "info",
        );
        return;
      }

      const model = ctx.modelRegistry.find(cfg.provider, cfg.modelId);
      const available = model && ctx.modelRegistry.getProviderAuthStatus(cfg.provider).configured;
      const cacheEntries = getCacheSize();

      const lines = [
        `Vision model: ${cfg.provider}/${cfg.modelId}`,
        `Status: ${available ? "✓ available" : "⚠ not available"}`,
        `Cache entries: ${cacheEntries}`,
        ``,
        `Use /visionizer-model to change, /visionizer-clear to disable.`,
      ];

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // /visionizer-clear — disable vision proxy
  pi.registerCommand("visionizer-clear", {
    description: "Disable vision proxy for text-only models",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      // Append a clear marker entry
      await pi.appendEntry(CUSTOM_TYPE, null);
      clearCache();
      ctx.ui.notify("Visionizer disabled. Image proxy turned off.", "success");
    },
  });
}
