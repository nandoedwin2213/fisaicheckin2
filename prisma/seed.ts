import { PrismaClient, ServiceType } from '@prisma/client';
import { hashApiKey } from '../src/checkin/terminal-key';

const prisma = new PrismaClient();

const TERMINAL_API_KEY = process.env.SEED_TERMINAL_KEY ?? 'clave-del-terminal';
const UID_PRUEBA = process.env.SEED_CARD_UID ?? 'A1B2C3D4';

async function main() {
  const terminal = await prisma.terminal.upsert({
    where: { apiKeyHash: hashApiKey(TERMINAL_API_KEY) },
    update: {},
    create: { nombre: 'Recepción', serviceType: ServiceType.REHAB, apiKeyHash: hashApiKey(TERMINAL_API_KEY) },
  });

  const paquete =
    (await prisma.package.findFirst({ where: { nombre: '10 sesiones rehabilitación' } })) ??
    (await prisma.package.create({
      data: {
        nombre: '10 sesiones rehabilitación',
        sesiones: 10,
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
        venceEn: new Date(Date.now() + paquete.vigenciaDias * 86_400_000),
      },
    });
  }

  console.log(`Terminal "${terminal.nombre}" listo. Prueba con UID ${UID_PRUEBA} y X-Terminal-Key: ${TERMINAL_API_KEY}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
