import "./browser-storage";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { canvasThemes } from "../src/lib/canvas-theme";
const { createModelChannel, defaultConfig } = await import("../src/stores/use-config-store");
const { VideoSettingsPanel, videoResolutionLabel, videoModeLabel, videoSizeLabel } = await import("../src/components/video-settings-panel");

function render(model: string, settings = {}) {
    const config = { ...defaultConfig, model: `ark::${model}`, channels: [createModelChannel({ id: "ark", apiFormat: "ark", models: [{ name: model, capability: "video" }] })], videoMode: "text", size: "adaptive", ...settings };
    return renderToStaticMarkup(<VideoSettingsPanel config={config} theme={canvasThemes.light} onConfigChange={() => {}} />);
}
describe("Ark model video settings", () => {
    test("2.0 exposes 4K but fast hides 1080p and 4K", () => {
        expect(render("doubao-seedance-2-0-260128")).toContain(">4K</button>");
        const fast = render("doubao-seedance-2-0-fast-260128");
        expect(fast).not.toContain(">4K</button>");
        expect(fast).not.toContain(">1080p</button>");
        expect(fast).not.toContain(">3:2</button>");
    });
    test("2.5 first frame only displays adaptive and flags retained invalid ratio", () => {
        const html = render("doubao-seedance-2-5-260628", { videoMode: "first_frame", size: "16:9" });
        expect(html).not.toContain(">16:9</button>");
        expect(html).toContain('role="alert"');
        expect(html).toContain("自适应");
    });
    test("1.0 fast excludes tail frame, reference and generated audio controls", () => {
        const html = render("doubao-seedance-1-0-pro-fast-251015", { size: "16:9" });
        expect(html).not.toContain(">首尾帧</button>");
        expect(html).not.toContain(">全模态参考</button>");
        expect(html).not.toContain("生成声音");
    });
    test("labels preserve Ark values", () => {
        expect(videoResolutionLabel("4k")).toBe("4K");
        expect(videoModeLabel("first_last_frame")).toBe("首尾帧");
        expect(videoSizeLabel("adaptive")).toBe("自适应");
    });
});
