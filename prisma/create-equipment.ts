/**
 * Da de alta un equipo (sillón de masaje, caminadora, …) con su tarifa.
 * Uso: npx ts-node prisma/create-equipment.ts "Sillón de masaje" REHAB MINUTOS 0.50 1800
 *   costo: créditos por uso (CREDITOS) o por minuto (MINUTOS); 0 en SESIONES.
 *   duracionSegundos: cuánto cierra el relé; en MINUTOS es además el tope del uso.
 */
import { BillingMode, PrismaClient, ServiceType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [nombre, serviceType, billingMode, costo, duracionSegundos] = process.argv.slice(2);
  if (!nombre || !serviceType || !billingMode || !duracionSegundos) {
    throw new Error(
      'Uso: create-equipment.ts <nombre> <REHAB|SARCO_FORCE|EVALUACION> <SESIONES|CREDITOS|MINUTOS> <costo> <duracionSegundos>',
    );
  }
  if (!(serviceType in ServiceType)) throw new Error(`serviceType inválido: ${serviceType}`);
  if (!(billingMode in BillingMode)) throw new Error(`billingMode inválido: ${billingMode}`);

  const equipo = await prisma.equipment.create({
    data: {
      nombre,
      serviceType: serviceType as ServiceType,
      billingMode: billingMode as BillingMode,
      costo: costo ?? 0,
      duracionSegundos: Number(duracionSegundos),
    },
  });
  console.log(`Equipo ${equipo.id} "${equipo.nombre}" creado (${equipo.billingMode}).`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
