import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    report: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    reportRevision: { findUniqueOrThrow: vi.fn().mockResolvedValue({ revision: 2 }) },
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));

import { deleteReportById, getReportById, getReports } from './report.service';

describe('report.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns paginated reports', async () => {
    prismaMock.report.findMany.mockResolvedValue([{ id: 'r1', dataRevision: 2 }, { id: 'r2', dataRevision: 1 }]);
    prismaMock.report.count.mockResolvedValue(12);

    const result = await getReports(2, 5);

    expect(result).toEqual({
      data: [{ id: 'r1', dataRevision: 2, isStale: false }, { id: 'r2', dataRevision: 1, isStale: true }],
      pagination: { page: 2, limit: 5, total: 12, totalPages: 3 },
    });
  });

  it('returns report by id', async () => {
    prismaMock.report.findUnique.mockResolvedValue({ id: 'r1', title: 'Jan report', dataRevision: 2 });
    await expect(getReportById('r1')).resolves.toEqual({ id: 'r1', title: 'Jan report', dataRevision: 2, isStale: false });
  });

  it('deletes report by id', async () => {
    prismaMock.report.delete.mockResolvedValue({ id: 'r1' });
    await deleteReportById('r1');
    expect(prismaMock.report.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
  });
});
