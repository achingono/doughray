import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('shared openai config', () => {
  beforeEach(() => {
    vi.resetModules();

    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    delete process.env.AZURE_OPENAI_ENDPOINT;
    delete process.env.AZURE_OPENAI_API_VERSION;
  });

  it('uses AzureOpenAI when Azure env vars are set', async () => {
    process.env.OPENAI_API_KEY = 'azure-key';
    process.env.OPENAI_MODEL = 'azure-deployment';
    process.env.AZURE_OPENAI_ENDPOINT = 'https://example-resource.azure.openai.com';
    process.env.AZURE_OPENAI_API_VERSION = '2024-02-15-preview';

    const { default: openai, getMissingOpenAIConfig } = await import('@doughray/shared');
    const client = (openai.chat as any)._client;

    expect(getMissingOpenAIConfig()).toEqual([]);
    expect(client.deploymentName).toBe('azure-deployment');
    expect(client.baseURL).toContain('https://example-resource.azure.openai.com/openai');
    expect(client.defaultQuery()).toMatchObject({
      'api-version': '2024-02-15-preview',
    });
  });

  it('reports the Azure API version when Azure endpoint is configured', async () => {
    process.env.OPENAI_API_KEY = 'azure-key';
    process.env.OPENAI_MODEL = 'azure-deployment';
    process.env.AZURE_OPENAI_ENDPOINT = 'https://example-resource.azure.openai.com';

    const { getMissingOpenAIConfig } = await import('@doughray/shared');

    expect(getMissingOpenAIConfig()).toEqual(['AZURE_OPENAI_API_VERSION']);
  });

});
