import { prisma } from '../lib/prisma';

export async function getReports(page: number = 1, limit: number = 10) {
  const [reports, total] = await Promise.all([
    prisma.report.findMany({
      orderBy: { generatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.report.count(),
  ]);

  const revision = await prisma.reportRevision.findUniqueOrThrow({ where: { id: 'ledger' } });
  return {
    data: reports.map((report) => ({ ...report, isStale: report.dataRevision !== revision.revision })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getReportById(id: string) {
  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) return null;
  const revision = await prisma.reportRevision.findUniqueOrThrow({ where: { id: 'ledger' } });
  return { ...report, isStale: report.dataRevision !== revision.revision };
}

export async function deleteReportById(id: string) {
  await prisma.report.delete({ where: { id } });
}
