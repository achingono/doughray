import prisma from '../lib/prisma';
import openai, {
  getMissingOpenAIConfig,
  getOpenAIModel,
  getOpenAITemperature,
  isOpenAIModelNotFoundError,
} from '../lib/openai';
import { buildValuationPrompt } from '../prompts/valuate';

function decimalToNumber(val: any): number {
  if (val === null || val === undefined) return 0;
  return Number(val);
}

export async function valuateAssets(): Promise<void> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const assets = await prisma.asset.findMany({
    where: {
      OR: [
        { lastValuationDate: null },
        { lastValuationDate: { lt: thirtyDaysAgo } },
      ],
    },
  });

  if (assets.length === 0) {
    console.log('[Valuate] No assets need valuation');
    return;
  }

  console.log(`[Valuate] ${assets.length} asset(s) need valuation`);

  for (const asset of assets) {
    if (asset.type === 'REAL_ESTATE' && !asset.address) {
      console.log(`[Valuate] Skipping "${asset.name}": no address for real estate valuation`);
      continue;
    }

    // Try external API first (if configured)
    const apiValue = await tryExternalApi(asset);
    if (apiValue !== null) {
      await saveValuation(asset.id, apiValue, 'API');
      console.log(`[Valuate] "${asset.name}" valued at $${apiValue.toLocaleString()} via API`);
      continue;
    }

    // Fall back to AI
    const aiValue = await tryAiValuation(asset);
    if (aiValue !== null) {
      await saveValuation(asset.id, aiValue, 'AI');
      console.log(`[Valuate] "${asset.name}" valued at $${aiValue.toLocaleString()} via AI`);
      continue;
    }

    console.log(`[Valuate] Could not valuate "${asset.name}" — no API or AI available`);
  }
}

async function tryExternalApi(asset: any): Promise<number | null> {
  const apiUrl = process.env.VALUATION_API_URL;
  const apiKey = process.env.VALUATION_API_KEY;

  if (!apiUrl || !apiKey) return null;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        type: asset.type,
        address: asset.address,
        name: asset.name,
        symbol: asset.metadata?.symbol,
        shares: asset.metadata?.shares,
        make: asset.metadata?.make,
        model: asset.metadata?.model,
        year: asset.metadata?.year,
        metadata: asset.metadata,
      }),
    });

    if (!response.ok) {
      console.warn(`[Valuate] API returned ${response.status} for "${asset.name}"`);
      return null;
    }

    const data: any = await response.json();
    return typeof data.estimatedValue === 'number' ? data.estimatedValue : null;
  } catch (err) {
    console.warn(`[Valuate] API call failed for "${asset.name}":`, err);
    return null;
  }
}

async function tryAiValuation(asset: any): Promise<number | null> {
  const missingConfig = getMissingOpenAIConfig();
  if (missingConfig.length > 0) {
    return null;
  }

  try {
    const prompt = buildValuationPrompt({
      type: asset.type,
      name: asset.name,
      address: asset.address,
      purchasePrice: decimalToNumber(asset.purchasePrice),
      purchaseDate: asset.purchaseDate?.toISOString().split('T')[0],
      metadata: asset.metadata,
    });

    const response = await openai.chat.completions.create({
      model: getOpenAIModel(),
      messages: [{ role: 'user', content: prompt }],
      temperature: getOpenAITemperature(),
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    const result = JSON.parse(content);
    return typeof result.estimatedValue === 'number' ? result.estimatedValue : null;
  } catch (err) {
    if (isOpenAIModelNotFoundError(err)) {
      console.error(`[Valuate] OpenAI model not found: "${getOpenAIModel()}"`);
    }
    console.warn(`[Valuate] AI valuation failed for "${asset.name}":`, err);
    return null;
  }
}

async function saveValuation(assetId: string, value: number, source: string): Promise<void> {
  await prisma.$transaction([
    prisma.assetValuation.create({
      data: {
        assetId,
        value,
        source,
        valuedAt: new Date(),
      },
    }),
    prisma.asset.update({
      where: { id: assetId },
      data: {
        currentValue: value,
        lastValuationDate: new Date(),
      },
    }),
  ]);
}
