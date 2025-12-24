import { readConfigFile } from ".";

/**
 * Calculate CLAUDE_AUTOCOMPACT_PCT_OVERRIDE based on model context size
 * Formula: (modelContextSize / 200) * 0.8
 * @param modelContextSize - Model context size in K
 * @returns Calculated percentage value
 */
const calculateAutoCompactPct = (modelContextSize: number): number => {
  const claudeContextSize = 200; // Claude official context size in K
  return (modelContextSize / claudeContextSize) * 0.8;
};

/**
 * Get model context size from config
 * @param config - Configuration object
 * @param modelKey - Model key in format "provider,model"
 * @returns Context size in K, or undefined if not found
 */
const getModelContextSize = (config: any, modelKey: string): number | undefined => {
  if (!modelKey) return undefined;
  
  const [providerName, modelName] = modelKey.split(',');
  if (!providerName || !modelName) return undefined;
  
  const provider = config.Providers?.find((p: any) => p.name === providerName);
  if (!provider || !provider.contextSize) return undefined;
  
  return provider.contextSize[modelName];
};

/**
 * Get environment variables for Agent SDK/Claude Code integration
 * This function is shared between `hccr env` and `hccr code` commands
 */
export const createEnvVariables = async () => {
  const config = await readConfigFile();
  const port = config.PORT || 3456;
  const apiKey = config.APIKEY || "test";

  const envVars: Record<string, string | undefined> = {
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    NO_PROXY: "127.0.0.1",
    DISABLE_TELEMETRY: "true",
    DISABLE_COST_WARNINGS: "true",
    API_TIMEOUT_MS: String(config.API_TIMEOUT_MS ?? 600000),
    // Reset CLAUDE_CODE_USE_BEDROCK when running with hccr
    CLAUDE_CODE_USE_BEDROCK: undefined,
  };

  // Calculate and set CLAUDE_AUTOCOMPACT_PCT_OVERRIDE based on default model's context size
  const defaultModel = config.Router?.default;
  if (defaultModel) {
    const contextSize = getModelContextSize(config, defaultModel);
    if (contextSize) {
      const autoCompactPct = calculateAutoCompactPct(contextSize);
      envVars.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = autoCompactPct.toFixed(2);
      console.log(`Setting CLAUDE_AUTOCOMPACT_PCT_OVERRIDE to ${autoCompactPct.toFixed(2)} (based on ${contextSize}K context)`);
    }
  }

  return envVars;
}