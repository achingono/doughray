import { PrismaClient } from '@prisma/client';
import { loadBankConfig, rotateBankTokenKeys } from '@doughray/shared';

// Run in maintenance mode only. Keys are read from the environment and never printed.
const oldSettings = loadBankConfig().encryption;
const nextSettings = loadBankConfig({
  BANK_TOKEN_ENCRYPTION_KEY: process.env.BANK_TOKEN_NEW_ENCRYPTION_KEY,
  BANK_TOKEN_ENCRYPTION_KEY_VERSION: process.env.BANK_TOKEN_NEW_ENCRYPTION_KEY_VERSION,
}).encryption;
const versionText = process.env.BANK_TOKEN_NEW_ENCRYPTION_KEY_VERSION ?? '';
const oldVersionText = process.env.BANK_TOKEN_ENCRYPTION_KEY_VERSION || '1';
if (!oldSettings.keyMaterial || !nextSettings.keyMaterial || !/^[1-9]\d*$/.test(versionText) ||
    Number(versionText) !== nextSettings.keyVersion || !/^[1-9]\d*$/.test(oldVersionText) ||
    Number(oldVersionText) !== oldSettings.keyVersion) {
  console.error('Set the current and new bank encryption keys and explicit new key version.');
  process.exit(1);
}
const prisma = new PrismaClient();
try {
  const result = await rotateBankTokenKeys(prisma, oldSettings.keyMaterial, oldSettings.keyVersion,
    nextSettings.keyMaterial, nextSettings.keyVersion);
  console.log(`Rotation committed for ${result.connections} connections and ${result.attempts} Link attempts.`);
  console.log('Configure the new key and version before restarting API or worker processes.');
} catch {
  console.error('Rotation failed; all changes were rolled back. Check keys, versions, and stored secret integrity.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
