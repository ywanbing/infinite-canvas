import "./browser-storage";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { canvasThemes } from "../src/lib/canvas-theme";

const { createModelChannel, defaultConfig } = await import("../src/stores/use-config-store");
const { ImageSettingsPanel, imageSizeLabel } = await import("../src/components/image-settings-panel");

function panelConfig(model: string, size: string, apiFormat: "ark" | "openai" = "ark") {
    return { ...defaultConfig, model: `channel::${model}`, size, channels: [createModelChannel({ id: "channel", apiFormat, models: [{ name: model, capability: "image" }] })] };
}

describe("Model image size panel", () => {
    test("shows lite resolution choices and matching default dimensions", () => {
        const config = panelConfig("doubao-seedream-5.0-lite", "1:1");
        const html = renderToStaticMarkup(<ImageSettingsPanel config={config} theme={canvasThemes.light} onConfigChange={() => {}} />);
        expect(html).toContain(">2K</button>");
        expect(html).toContain(">3K</button>");
        expect(html).toContain(">4K</button>");
        expect(html).not.toContain(">1K</button>");
        expect(html).toContain('value="2048"');
        expect(imageSizeLabel(config.size, config)).toBe("2K · 1:1");
    });

    test("shows pro choices and alerts on an oversized value retained from lite", () => {
        const config = panelConfig("doubao-seedream-5.0-pro", "4096x4096");
        const html = renderToStaticMarkup(<ImageSettingsPanel config={config} theme={canvasThemes.dark} onConfigChange={() => {}} />);
        expect(html).toContain(">1.5K</button>");
        expect(html).not.toContain(">3K</button>");
        expect(html).not.toContain(">4K</button>");
        expect(html).toContain('role="alert"');
        expect(html).toContain("4624220");
        expect(html).toContain('value="4096"');
    });

    test("labels model-decided ratios without inventing square dimensions", () => {
        const config = panelConfig("doubao-seedream-5.0-lite", "3K");
        expect(imageSizeLabel(config.size, config)).toBe("3K · 自动");
        const html = renderToStaticMarkup(<ImageSettingsPanel config={config} theme={canvasThemes.light} onConfigChange={() => {}} />);
        expect(html).not.toContain('value="3072"');
        expect(html).not.toContain('role="alert"');
    });

    test("preserves the generic size panel for OpenAI", () => {
        const config = panelConfig("gpt-image-1", "1024x1024", "openai");
        const html = renderToStaticMarkup(<ImageSettingsPanel config={config} theme={canvasThemes.light} onConfigChange={() => {}} />);
        expect(html).toContain(">1K</button>");
        expect(html).not.toContain(">3K</button>");
        expect(html).toContain('value="1024"');
    });
});
