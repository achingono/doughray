import { Decimal } from '@prisma/client/runtime/library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    asset: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn(),
    },
    account: {
      findUnique: vi.fn(),
    },
    assetValuation: {
      create: vi.fn(),
    },
    netWorthSnapshot: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));

import {
  addValuation,
  createAsset,
  deleteAsset,
  getAssetById,
  getAssets,
  getTotalAssetValue,
  updateAsset,
} from './asset.service';
import { AppError } from '../middleware/error-handler';

describe('asset.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps list and detail assets', async () => {
    prismaMock.asset.findMany.mockResolvedValue([
      {
        id: 'a1',
        name: 'Home',
        type: 'REAL_ESTATE',
        purchasePrice: new Decimal('200000'),
        currentValue: new Decimal('250000'),
        purchaseDate: null,
        address: null,
        metadata: null,
        lastValuationDate: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    prismaMock.asset.findUnique.mockResolvedValue({
      id: 'a1',
      name: 'Home',
      type: 'REAL_ESTATE',
      purchasePrice: new Decimal('200000'),
      currentValue: new Decimal('250000'),
      purchaseDate: null,
      address: null,
      metadata: null,
      lastValuationDate: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      valuations: [
        { id: 'v1', value: new Decimal('250000'), source: 'MANUAL', valuedAt: new Date('2026-01-01T00:00:00.000Z') },
      ],
    });

    const list = await getAssets();
    const detail = await getAssetById('a1');

    expect(list[0]).toEqual(expect.objectContaining({ id: 'a1', currentValue: 250000 }));
    expect(detail?.valuations[0]).toEqual(expect.objectContaining({ id: 'v1', value: 250000 }));
  });

  it('creates, updates and deletes assets', async () => {
    prismaMock.asset.create.mockResolvedValue({
      id: 'a2',
      name: 'Stock',
      type: 'STOCK',
      purchasePrice: new Decimal('1000'),
      currentValue: new Decimal('1200'),
      purchaseDate: new Date('2026-01-01T14:25:00.000Z'),
      address: null,
      metadata: null,
      lastValuationDate: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    prismaMock.asset.update.mockResolvedValue({
      id: 'a2',
      name: 'Stock',
      type: 'STOCK',
      purchasePrice: new Decimal('1000'),
      currentValue: new Decimal('1300'),
      purchaseDate: null,
      address: null,
      metadata: null,
      lastValuationDate: new Date('2026-01-02T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    prismaMock.asset.delete.mockResolvedValue({ id: 'a2' });

    const created = await createAsset({
      name: 'Stock',
      purchasePrice: 1000,
      currentValue: 1200,
      type: 'STOCK',
      purchaseDate: new Date('2026-01-01T14:25:00.000Z'),
    });
    const updated = await updateAsset('a2', { currentValue: 1300 });
    await deleteAsset('a2');
    const expectedStartDate = new Date('2026-01-01T14:25:00.000Z');
    expectedStartDate.setHours(0, 0, 0, 0);

    expect(created.currentValue).toBe(1200);
    expect(updated.currentValue).toBe(1300);
    expect(prismaMock.asset.delete).toHaveBeenCalledWith({ where: { id: 'a2' } });
    expect(prismaMock.netWorthSnapshot.updateMany).toHaveBeenCalledWith({
      where: { date: { gte: expectedStartDate } },
      data: {
        totalAssets: { increment: 1200 },
        netWorth: { increment: 1200 },
      },
    });
  });

  it('adds valuation and computes aggregate value', async () => {
    prismaMock.$transaction.mockImplementation(async (steps: any[]) => Promise.all(steps));
    prismaMock.assetValuation.create.mockResolvedValue({
      id: 'v2',
      value: new Decimal('300000'),
      source: 'AI',
      valuedAt: new Date('2026-01-03T00:00:00.000Z'),
    });
    prismaMock.asset.update.mockResolvedValue({ id: 'a1' });
    prismaMock.asset.aggregate.mockResolvedValue({ _sum: { currentValue: new Decimal('345000') } });

    const valuation = await addValuation('a1', { value: 300000, source: 'AI' });
    const total = await getTotalAssetValue();

    expect(valuation).toEqual(expect.objectContaining({ id: 'v2', value: 300000, source: 'AI' }));
    expect(total).toBe(345000);
  });

  it('creates asset with liability account link', async () => {
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'mortgage-acct',
      type: 'MORTGAGE',
    });
    prismaMock.asset.create.mockResolvedValue({
      id: 'asset-home',
      name: 'Primary Residence',
      type: 'REAL_ESTATE',
      purchasePrice: new Decimal('600000'),
      currentValue: new Decimal('750000'),
      purchaseDate: new Date('2020-01-01T00:00:00.000Z'),
      address: '123 Main St',
      metadata: null,
      lastValuationDate: new Date('2026-04-24T00:00:00.000Z'),
      accountId: 'mortgage-acct',
      createdAt: new Date('2026-04-24T00:00:00.000Z'),
      updatedAt: new Date('2026-04-24T00:00:00.000Z'),
    });

    const created = await createAsset({
      name: 'Primary Residence',
      type: 'REAL_ESTATE',
      purchasePrice: 600000,
      currentValue: 750000,
      purchaseDate: new Date('2020-01-01T00:00:00.000Z'),
      address: '123 Main St',
      accountId: 'mortgage-acct',
    });

    expect(prismaMock.account.findUnique).toHaveBeenCalledWith({
      where: { id: 'mortgage-acct' },
      select: { type: true },
    });
    expect(prismaMock.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountId: 'mortgage-acct',
        }),
      }),
    );
    expect(created).toEqual(
      expect.objectContaining({
        id: 'asset-home',
        accountId: 'mortgage-acct',
      }),
    );
  });

  it('rejects asset link to non-existent account', async () => {
    prismaMock.account.findUnique.mockResolvedValue(null);

    await expect(
      createAsset({
        name: 'Vehicle',
        type: 'AUTOMOBILE',
        purchasePrice: 35000,
        currentValue: 28000,
        accountId: 'nonexistent-loan',
      }),
    ).rejects.toMatchObject({
      name: 'AppError',
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Account not found: nonexistent-loan',
    } satisfies Partial<AppError>);
  });

  it('rejects asset link to non-liability account', async () => {
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'checking-acct',
      type: 'CHECKING',
    });

    await expect(
      createAsset({
        name: 'Vehicle',
        type: 'AUTOMOBILE',
        purchasePrice: 35000,
        currentValue: 28000,
        accountId: 'checking-acct',
      }),
    ).rejects.toMatchObject({
      name: 'AppError',
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    } satisfies Partial<AppError>);
  });

  it('updates asset to link/unlink liability account', async () => {
    prismaMock.account.findUnique.mockResolvedValue({
      id: 'auto-loan',
      type: 'LOAN',
    });
    prismaMock.asset.update.mockResolvedValue({
      id: 'vehicle-asset',
      name: 'Tesla Model 3',
      type: 'AUTOMOBILE',
      purchasePrice: new Decimal('50000'),
      currentValue: new Decimal('40000'),
      purchaseDate: null,
      address: null,
      metadata: null,
      lastValuationDate: null,
      accountId: 'auto-loan',
      createdAt: new Date('2026-04-24T00:00:00.000Z'),
      updatedAt: new Date('2026-04-24T00:00:00.000Z'),
    });

    const updated = await updateAsset('vehicle-asset', {
      accountId: 'auto-loan',
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: 'vehicle-asset',
        accountId: 'auto-loan',
      }),
    );
  });

  it('allows unlinking asset from account by setting accountId to null', async () => {
    prismaMock.asset.update.mockResolvedValue({
      id: 'vehicle-asset',
      name: 'Tesla Model 3',
      type: 'AUTOMOBILE',
      purchasePrice: new Decimal('50000'),
      currentValue: new Decimal('40000'),
      purchaseDate: null,
      address: null,
      metadata: null,
      lastValuationDate: null,
      accountId: null,
      createdAt: new Date('2026-04-24T00:00:00.000Z'),
      updatedAt: new Date('2026-04-24T00:00:00.000Z'),
    });

    const updated = await updateAsset('vehicle-asset', {
      accountId: null,
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: 'vehicle-asset',
        accountId: null,
      }),
    );
  });
});
