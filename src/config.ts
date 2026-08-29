export interface AppConfig {
  port: number;
  serialBaudRate: number;
  motorCooldownMs: number;
  maxDiagnosticActivations: number;
  azure?: {
    endpoint: string;
    apiKey: string;
    deployment: string;
    apiVersion: string;
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const endpoint = env.AZURE_OPENAI_ENDPOINT;
  const apiKey = env.AZURE_OPENAI_API_KEY;
  const deployment = env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = env.AZURE_OPENAI_API_VERSION;
  const azure = endpoint && apiKey && deployment && apiVersion
    ? { endpoint, apiKey, deployment, apiVersion }
    : undefined;

  return {
    port: positiveInteger(env.PORT, 3000),
    serialBaudRate: positiveInteger(env.SERIAL_BAUD_RATE, 115200),
    motorCooldownMs: positiveInteger(env.MOTOR_COOLDOWN_MS, 2000),
    maxDiagnosticActivations: positiveInteger(env.MAX_DIAGNOSTIC_ACTIVATIONS, 4),
    ...(azure ? { azure } : {})
  };
}
