import { BillingMode, PrismaClient, ServiceType } from '@prisma/client';
import { hashApiKey } from '../src/checkin/terminal-key';

const prisma = new PrismaClient();

const TERMINAL_API_KEY = process.env.SEED_TERMINAL_KEY ?? 'clave-del-terminal';
const UID_PRUEBA = process.env.SEED_CARD_UID ?? 'A1B2C3D4';
const SILLON_API_KEY = process.env.SEED_SILLON_KEY ?? 'clave-del-sillon';

async function main() {
  const terminal = await prisma.terminal.upsert({
    where: { apiKeyHash: hashApiKey(TERMINAL_API_KEY) },
    update: {},
    create: { nombre: 'Recepción', serviceType: ServiceType.REHAB, apiKeyHash: hashApiKey(TERMINAL_API_KEY) },
  });

  const sillon =
    (await prisma.equipment.findFirst({ where: { nombre: 'Sillón de masaje' } })) ??
    (await prisma.equipment.create({
      data: {
        nombre: 'Sillón de masaje',
        serviceType: ServiceType.REHAB,
        billingMode: BillingMode.MINUTOS,
        costo: 0.5,
        duracionSegundos: 1800,
      },
    }));

  await prisma.terminal.upsert({
    where: { apiKeyHash: hashApiKey(SILLON_API_KEY) },
    update: { equipmentId: sillon.id },
    create: {
      nombre: 'Sillón de masaje',
      serviceType: ServiceType.REHAB,
      apiKeyHash: hashApiKey(SILLON_API_KEY),
      equipmentId: sillon.id,
    },
  });

  const paquete =
    (await prisma.package.findFirst({ where: { nombre: '10 sesiones rehabilitación' } })) ??
    (await prisma.package.create({
      data: {
        nombre: '10 sesiones rehabilitación',
        sesiones: 10,
        creditos: 20,
        vigenciaDias: 60,
        precio: 150,
        serviceType: ServiceType.REHAB,
      },
    }));

  const paciente = await prisma.patient.upsert({
    where: { cedula: '1712345678' },
    update: {},
    create: { cedula: '1712345678', nombre: 'Ana Pérez' },
  });

  await prisma.card.upsert({
    where: { uid: UID_PRUEBA },
    update: { patientId: paciente.id, activa: true },
    create: { uid: UID_PRUEBA, patientId: paciente.id },
  });

  const yaTiene = await prisma.patientPackage.findFirst({ where: { patientId: paciente.id, packageId: paquete.id } });
  if (!yaTiene) {
    await prisma.patientPackage.create({
      data: {
        patientId: paciente.id,
        packageId: paquete.id,
        sesionesRestantes: paquete.sesiones,
        creditosRestantes: paquete.creditos,
        venceEn: new Date(Date.now() + paquete.vigenciaDias * 86_400_000),
      },
    });
  }

  console.log(
    `Terminal "${terminal.nombre}" listo. Prueba con UID ${UID_PRUEBA} y X-Terminal-Key: ${TERMINAL_API_KEY}`,
  );
  console.log(`Terminal "Sillón de masaje" (cobro por minutos) con X-Terminal-Key: ${SILLON_API_KEY}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
