import { prisma } from '../lib/prisma';

export async function getLatestSync() {
  return prisma.syncLog.findFirst({
    orderBy: { startedAt: 'desc' },
  });
}

export async function getSyncHistory(limit: number = 10) {
  return prisma.syncLog.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
  });
}

export async function triggerSync() {
  const log = await prisma.syncLog.create({
    data: {
      status: 'RUNNING',
    },
  });
  return log;
}
