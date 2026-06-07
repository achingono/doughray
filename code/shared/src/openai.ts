import OpenAI, { AzureOpenAI } from 'openai';

type OpenAICompatibleError = {
  code?: string;
  status?: number;
  error?: {
    code?: string;
    message?: string;
  };
};

function getTrimmedEnvValue(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }

  return '';
}

function getOpenAIConfig() {
  return {
    baseUrl: getTrimmedEnvValue('OPENAI_BASE_URL'),
    apiKey: getTrimmedEnvValue('OPENAI_API_KEY'),
    model: getTrimmedEnvValue('OPENAI_MODEL'),
  };
}

function getAzureOpenAIConfig() {
  return {
    endpoint: getTrimmedEnvValue('AZURE_OPENAI_ENDPOINT'),
    apiKey: getTrimmedEnvValue('OPENAI_API_KEY'),
    apiVersion: getTrimmedEnvValue('AZURE_OPENAI_API_VERSION'),
    deployment: getTrimmedEnvValue('OPENAI_MODEL'),
  };
}

export function getMissingOpenAIConfig(): string[] {
  const openAiConfig = getOpenAIConfig();
  const azureOpenAiConfig = getAzureOpenAIConfig();
  const missing: string[] = [];

  if (azureOpenAiConfig.endpoint) {
    if (!azureOpenAiConfig.apiKey) missing.push('OPENAI_API_KEY');
    if (!azureOpenAiConfig.deployment) missing.push('OPENAI_MODEL');
    if (!azureOpenAiConfig.apiVersion) missing.push('AZURE_OPENAI_API_VERSION');
    return missing;
  }

  if (!openAiConfig.apiKey) missing.push('OPENAI_API_KEY');
  if (!openAiConfig.model) missing.push('OPENAI_MODEL');

  return missing;
}

export function getOpenAIModel(): string {
  return getOpenAIConfig().model;
}

export function getOpenAITemperature(): number {
  const raw = getTrimmedEnvValue('OPENAI_TEMPERATURE');
  if (!raw) return 1;

  const parsed = Number(raw);
  return Number.isNaN(parsed) ? 1 : parsed;
}

export function isOpenAIModelNotFoundError(err: unknown): boolean {
  const error = err as OpenAICompatibleError;
  const code = error.code ?? error.error?.code;
  const message = error.error?.message?.toLowerCase();

  return code === 'DeploymentNotFound'
    || code === 'model_not_found'
    || (error.status === 404 && typeof message === 'string' && message.includes('model'));
}

let client: OpenAI | AzureOpenAI | null = null;

function getClient(): OpenAI | AzureOpenAI {
  if (client) return client;

  const azureOpenAiConfig = getAzureOpenAIConfig();
  if (azureOpenAiConfig.endpoint) {
    client = new AzureOpenAI({
      apiKey: azureOpenAiConfig.apiKey,
      apiVersion: azureOpenAiConfig.apiVersion,
      deployment: azureOpenAiConfig.deployment,
      endpoint: azureOpenAiConfig.endpoint,
    });

    return client;
  }

  const openAiConfig = getOpenAIConfig();
  client = new OpenAI({
    apiKey: openAiConfig.apiKey,
    baseURL: openAiConfig.baseUrl || undefined,
  });

  return client;
}

const openai = {
  get chat() {
    return getClient().chat;
  },
};

export default openai;
