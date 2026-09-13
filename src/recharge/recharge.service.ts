import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface RechargeResponse {
  ok: boolean;
  patientPackageId: string;
  paciente: string;
  paquete: string;
  sesionesRestantes: number;
  creditosRestantes: number;
  venceEn: string;
}

export interface SaldoResponse {
  paciente: string;
  paquetes: {
    id: string;
    paquete: string;
    serviceType: string;
    sesionesRestantes: number;
    creditosRestantes: number;
    venceEn: string;
    vigente: boolean;
  }[];
}

@Injectable()
export class RechargeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Caja: vende un paquete al paciente y le carga sus sesiones y/o créditos. */
  async recargar(cedula: string, packageId: string, registradoPor?: string): Promise<RechargeResponse> {
    const patient = await this.prisma.patient.findUnique({ where: { cedula } });
    if (!patient || !patient.activo) throw new NotFoundException('Paciente no encontrado');

    const paquete = await this.prisma.package.findUnique({ where: { id: packageId } });
    if (!paquete || !paquete.activo) throw new NotFoundException('Paquete no encontrado');

    const venceEn = new Date(Date.now() + paquete.vigenciaDias * 86_400_000);

    const patientPackage = await this.prisma.$transaction(async (tx) => {
      const creado = await tx.patientPackage.create({
        data: {
          patientId: patient.id,
          packageId: paquete.id,
          sesionesRestantes: paquete.sesiones,
          creditosRestantes: paquete.creditos,
          venceEn,
        },
      });
      await tx.recharge.create({
        data: {
          patientId: patient.id,
          patientPackageId: creado.id,
          sesiones: paquete.sesiones,
          creditos: paquete.creditos,
          monto: paquete.precio,
          registradoPor,
        },
      });
      return creado;
    });

    return {
      ok: true,
      patientPackageId: patientPackage.id,
      paciente: patient.nombre,
      paquete: paquete.nombre,
      sesionesRestantes: patientPackage.sesionesRestantes,
      creditosRestantes: Number(patientPackage.creditosRestantes),
      venceEn: patientPackage.venceEn.toISOString(),
    };
  }

  async saldo(cedula: string): Promise<SaldoResponse> {
    const patient = await this.prisma.patient.findUnique({
      where: { cedula },
      include: { packages: { include: { package: true }, orderBy: { venceEn: 'asc' } } },
    });
    if (!patient) throw new NotFoundException('Paciente no encontrado');

    const ahora = Date.now();
    return {
      paciente: patient.nombre,
      paquetes: patient.packages.map((pp) => ({
        id: pp.id,
        paquete: pp.package.nombre,
        serviceType: pp.package.serviceType,
        sesionesRestantes: pp.sesionesRestantes,
        creditosRestantes: Number(pp.creditosRestantes),
        venceEn: pp.venceEn.toISOString(),
        vigente: pp.venceEn.getTime() >= ahora,
      })),
    };
  }
}
