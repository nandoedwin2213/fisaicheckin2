/**
 * Da de alta un terminal guardando solo el hash de su clave.
 * Uso: npx ts-node prisma/create-terminal.ts "Recepción" REHAB "clave-del-terminal"
 */
import { PrismaClient, ServiceType } from '@prisma/client';
import { hashApiKey } from '../src/checkin/terminal-key';

const prisma = new PrismaClient();

async function main() {
  const [nombre, serviceType, apiKey] = process.argv.slice(2);
  if (!nombre || !serviceType || !apiKey) {
    throw new Error('Uso: create-terminal.ts <nombre> <REHAB|SARCO_FORCE|EVALUACION> <apiKey>');
  }
  if (!(serviceType in ServiceType)) {
    throw new Error(`serviceType inválido: ${serviceType}`);
  }

  const terminal = await prisma.terminal.create({
    data: { nombre, serviceType: serviceType as ServiceType, apiKeyHash: hashApiKey(apiKey) },
  });
  console.log(`Terminal ${terminal.id} "${terminal.nombre}" creado. Graba esta clave en el firmware: ${apiKey}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
