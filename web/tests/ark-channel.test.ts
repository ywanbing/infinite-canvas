import "./browser-storage";
import { describe, expect, test } from "bun:test";

const { createModelChannel, defaultConfig, resolveModelRequestConfig, guessCapability, useConfigStore } = await import("../src/stores/use-config-store");
const { arkAccessModes } = await import("../src/lib/ark-channel-config");

describe("Ark channel access modes", () => {
    test("offers only standard API and Agent Plan", () => {
        expect(arkAccessModes.map((item) => item.value)).toEqual(["api", "agent-plan"]);
    });
    test.each([
        ["api", "https://ark.cn-beijing.volces.com/api/v3"],
        ["agent-plan", "https://ark.cn-beijing.volces.com/api/plan/v3"],
    ] as const)("%s keeps its endpoint and mode when resolving a model", (arkAccessMode, baseUrl) => {
        const channel = createModelChannel({ id: "ark", apiFormat: "ark", arkAccessMode, models: [{ name: "doubao-seedance-1.5-pro", capability: "video" }] });
        expect(channel.baseUrl).toBe(baseUrl);
        const request = resolveModelRequestConfig({ ...defaultConfig, channels: [channel] }, "ark::doubao-seedance-1.5-pro");
        expect(request.arkAccessMode).toBe(arkAccessMode);
        expect(request.baseUrl).toBe(baseUrl);
    });
    test("preserves custom endpoints and does not attach Ark modes to other protocols", () => {
        expect(createModelChannel({ apiFormat: "ark", arkAccessMode: "agent-plan", baseUrl: "https://example.com/custom/v3" }).baseUrl).toBe("https://example.com/custom/v3");
        expect(createModelChannel({ apiFormat: "openai", arkAccessMode: "agent-plan" }).arkAccessMode).toBeUndefined();
        expect(guessCapability("doubao-seedance-1.5-pro")).toBe("video");
    });
    test("persists Ark modes, smart duration and 4k without generic normalization", async () => {
        const channel = createModelChannel({ id: "ark", apiFormat: "ark", arkAccessMode: "agent-plan" });
        useConfigStore.setState({ config: { ...defaultConfig, channels: [channel], videoMode: "edit", videoSeconds: "-1", vquality: "4k" } });
        await useConfigStore.persist.rehydrate();
        expect(useConfigStore.getState().config).toMatchObject({ videoMode: "edit", videoSeconds: "-1", vquality: "4k", channels: [{ arkAccessMode: "agent-plan" }] });
        useConfigStore.setState({ config: defaultConfig });
    });
});
