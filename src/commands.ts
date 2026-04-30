/**
 * User commands for pi-visionizer.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { clearCache, getCacheSize } from "./vision-client";
import { CUSTOM_TYPE, DEFAULT_PROMPT, getConfig, type VisionizerConfig } from "./config";

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

      const labels = visionModels.map((m) => {
        const isCurrent = m.id === currentCfg?.modelId && m.provider === currentCfg?.provider;
        return `${m.provider}/${m.id}${isCurrent ? " (current)" : ""}`;
      });

      const picked = await ctx.ui.select(
        `Pick a vision model (current: ${currentId ?? "none"}):`,
        labels,
      );

      if (!picked) return;

      // Strip " (current)" suffix if present
      const clean = picked.replace(/ \(current\)$/, "");
      const [provider, ...rest] = clean.split("/");
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

      // Actually resolve auth — same path the vision client will use.
      let available = false;
      let authError = "";
      if (model) {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
        available = auth.ok && !!auth.apiKey;
        if (!available && auth.error) {
          authError = auth.error;
        }
      }

      const cacheEntries = getCacheSize();

      const lines = [
        `Vision model: ${cfg.provider}/${cfg.modelId}`,
        `Status: ${available ? "✓ available" : "⚠ not available"}`,
        ...(authError ? [`Reason: ${authError}`] : []),
        `HTTPS required: ${cfg.requireHttps !== false ? "on" : "off"}`,
        `Cache entries: ${cacheEntries}`,
        ``,
        `Use /visionizer-model to change, /visionizer-clear to disable.`,
      ];

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // /visionizer-https — toggle HTTPS requirement
  pi.registerCommand("visionizer-https", {
    description: "Toggle HTTPS requirement for vision model endpoint",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      const cfg = getConfig(ctx);
      if (!cfg) {
        ctx.ui.notify(
          "No vision model configured. Use /visionizer-model first.",
          "warning",
        );
        return;
      }

      const current = cfg.requireHttps !== false;
      const updated: VisionizerConfig = { ...cfg, requireHttps: !current };
      await pi.appendEntry(CUSTOM_TYPE, updated);

      ctx.ui.notify(
        `HTTPS requirement ${updated.requireHttps ? "enabled" : "disabled"}.` +
          (updated.requireHttps ? "" : " Local models (Ollama, etc.) can now be used."),
        "success",
      );
    },
  });

  // /visionizer-prompt — customize the image description prompt
  pi.registerCommand("visionizer-prompt", {
    description: "Set a custom prompt for the vision model when describing images",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      const currentCfg = getConfig(ctx);
      const currentPrompt = currentCfg?.prompt || DEFAULT_PROMPT;

      // Show current prompt and ask for new one
      ctx.ui.notify(`Current prompt:\n${currentPrompt}`, "info");

      const newPrompt = await ctx.ui.input(
        "Enter new vision prompt (empty to reset to default):",
        "Describe this image...",
      );

      if (newPrompt === undefined) return; // user cancelled

      if (currentCfg) {
        const updated = newPrompt.trim()
          ? { ...currentCfg, prompt: newPrompt.trim() }
          : { provider: currentCfg.provider, modelId: currentCfg.modelId };
        await pi.appendEntry(CUSTOM_TYPE, updated);
        ctx.ui.notify(
          newPrompt.trim() ? "Vision prompt updated." : "Vision prompt reset to default.",
          "success",
        );
      } else {
        ctx.ui.notify(
          "No vision model configured. Use /visionizer-model first.",
          "warning",
        );
      }
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
