import "./browser-storage";
import { expect, test } from "bun:test";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
const { buildNodeGenerationContext, hydrateNodeGenerationContext } = await import("../src/components/canvas/canvas-node-generation");

test("canvas remote video references remain separate from local playback", () => {
    const node: CanvasNodeData = { id: "video", type: CanvasNodeType.Video, title: "镜头", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "blob:local", storageKey: "video:local", videoReferenceUrl: "asset://remote", durationMs: 5000 } };
    const context = buildNodeGenerationContext("target", [node], [{ id: "edge", fromNodeId: "video", toNodeId: "target" }], "");
    expect(context.referenceVideos[0]).toMatchObject({ url: "blob:local", referenceUrl: "asset://remote", storageKey: "video:local", durationMs: 5000 });
    node.metadata = { videoReferenceUrl: "https://example.com/video.mp4" };
    expect(buildNodeGenerationContext("target", [node], [{ id: "edge", fromNodeId: "video", toNodeId: "target" }], "").referenceVideos).toHaveLength(1);
});

test("Ark canvas hydration preserves asset and HTTPS image sources", async () => {
    const references = ["asset://image", "https://example.com/image.png"].map((dataUrl, i) => ({ id: String(i), name: "image", type: "image/png", dataUrl }));
    const context = await hydrateNodeGenerationContext({ prompt: "", referenceImages: references, referenceVideos: [], referenceAudios: [], imageCount: 2, videoCount: 0, audioCount: 0, textCount: 0 }, true);
    expect(context.referenceImages).toEqual(references);
});
