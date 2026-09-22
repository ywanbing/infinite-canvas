export type ArkAccessMode = "api" | "agent-plan";

export type ArkAssetConfig = {
    accessKeyId: string;
    secretAccessKey: string;
    groupId: string;
    projectName: string;
};

export const arkAccessModes = [
    { value: "api", label: "标准 API", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" },
    { value: "agent-plan", label: "Agent Plan", baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3" },
] as const;

export function arkAccessConfig(mode: ArkAccessMode = "api") {
    return arkAccessModes.find((item) => item.value === mode) || arkAccessModes[0];
}
