import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttendanceResult, Prisma, ServiceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashApiKey } from './terminal-key';
import { normalizarUid } from './uid';

export interface CheckinResponse {
  ok: boolean;
  resultado: AttendanceResult;
  paciente?: string;
  sesionesRestantes?: number;
  venceEn?: string;
}

interface ConsumoOk {
  resultado: typeof AttendanceResult.OK;
  patientPackageId: string;
  sesionesRestantes: number;
  venceEn: Date;
}

interface ConsumoFallido {
  resultado: Exclude<AttendanceResult, typeof AttendanceResult.OK>;
}

type Consumo = ConsumoOk | ConsumoFallido;

@Injectable()
export class CheckinService {
  private readonly ventanaDuplicadoMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.ventanaDuplicadoMs = Number(config.get('DUPLICATE_WINDOW_SECONDS') ?? 60) * 1000;
  }

  /** Llamado por el ESP32: identifica al paciente por la tarjeta y descuenta una sesión. */
  async checkinPorTarjeta(uidCrudo: string, apiKey: string): Promise<CheckinResponse> {
    const terminal = await this.prisma.terminal.findUnique({ where: { apiKeyHash: hashApiKey(apiKey) } });
    if (!terminal || !terminal.activo) throw new UnauthorizedException('Terminal no autorizado');

    const uid = normalizarUid(uidCrudo);
    if (!uid) throw new BadRequestException('uid inválido');

    void this.prisma.terminal
      .update({ where: { id: terminal.id }, data: { ultimoVisto: new Date() } })
      .catch(() => undefined);

    const card = await this.prisma.card.findUnique({ where: { uid } });

    if (!card) return this.registrar({ terminalId: terminal.id, uidLeido: uid, resultado: AttendanceResult.TARJETA_DESCONOCIDA });
    if (!card.activa) {
      return this.registrar({
        terminalId: terminal.id,
        uidLeido: uid,
        resultado: AttendanceResult.TARJETA_INACTIVA,
        cardId: card.id,
        patientId: card.patientId,
      });
    }
    if (!card.patientId) {
      return this.registrar({
        terminalId: terminal.id,
        uidLeido: uid,
        resultado: AttendanceResult.TARJETA_SIN_PACIENTE,
        cardId: card.id,
      });
    }

    return this.procesar({
      terminalId: terminal.id,
      serviceType: terminal.serviceType,
      patientId: card.patientId,
      cardId: card.id,
      uidLeido: uid,
      manual: false,
    });
  }

  /**
   * Llamado por recepción cuando el paciente olvidó la tarjeta. No pasa por Card: identifica
   * por cédula, no aplica la ventana anti doble lectura (es una excepción deliberada) y deja
   * el registro marcado como manual con el usuario responsable.
   */
  async checkinManual(cedula: string, terminalId: string, registradoPor?: string): Promise<CheckinResponse> {
    const terminal = await this.prisma.terminal.findUnique({ where: { id: terminalId } });
    if (!terminal || !terminal.activo) throw new NotFoundException('Terminal no encontrado');

    const patient = await this.prisma.patient.findUnique({ where: { cedula } });
    if (!patient || !patient.activo) {
      return this.registrar({
        terminalId: terminal.id,
        resultado: AttendanceResult.PACIENTE_DESCONOCIDO,
        manual: true,
        registradoPor,
      });
    }

    return this.procesar({
      terminalId: terminal.id,
      serviceType: terminal.serviceType,
      patientId: patient.id,
      manual: true,
      registradoPor,
    });
  }

  /**
   * Descuento y registro en una sola transacción: si el registro de asistencia falla,
   * la sesión descontada se revierte.
   */
  private async procesar(args: {
    terminalId: string;
    serviceType: ServiceType;
    patientId: string;
    cardId?: string;
    uidLeido?: string;
    manual: boolean;
    registradoPor?: string;
  }): Promise<CheckinResponse> {
    return this.prisma.$transaction(async (tx) => {
      if (!args.manual && args.cardId) {
        const duplicado = await tx.attendance.findFirst({
          where: {
            cardId: args.cardId,
            terminalId: args.terminalId,
            resultado: AttendanceResult.OK,
            createdAt: { gte: new Date(Date.now() - this.ventanaDuplicadoMs) },
          },
          select: { id: true },
        });
        if (duplicado) {
          return this.registrar({ ...args, resultado: AttendanceResult.DUPLICADO }, tx);
        }
      }

      const consumo = await this.consumirSesion(tx, args.patientId, args.serviceType);
      const respuesta = await this.registrar(
        {
          ...args,
          resultado: consumo.resultado,
          patientPackageId: consumo.resultado === AttendanceResult.OK ? consumo.patientPackageId : undefined,
        },
        tx,
      );

      if (consumo.resultado !== AttendanceResult.OK) return respuesta;

      const patient = await tx.patient.findUniqueOrThrow({
        where: { id: args.patientId },
        select: { nombre: true },
      });

      return {
        ...respuesta,
        paciente: patient.nombre.split(' ')[0],
        sesionesRestantes: consumo.sesionesRestantes,
        venceEn: consumo.venceEn.toISOString(),
      };
    });
  }

  /**
   * Elige el paquete vigente del mismo servicio que vence primero y lo decrementa con
   * `updateMany` condicionado a `sesionesRestantes > 0`, para que dos terminales simultáneos
   * no puedan gastar el mismo crédito.
   */
  private async consumirSesion(
    tx: Prisma.TransactionClient,
    patientId: string,
    serviceType: ServiceType,
  ): Promise<Consumo> {
    const ahora = new Date();

    const paquete = await tx.patientPackage.findFirst({
      where: {
        patientId,
        package: { serviceType, activo: true },
        sesionesRestantes: { gt: 0 },
        venceEn: { gte: ahora },
      },
      orderBy: { venceEn: 'asc' },
    });

    if (!paquete) {
      const vencido = await tx.patientPackage.findFirst({
        where: {
          patientId,
          package: { serviceType },
          sesionesRestantes: { gt: 0 },
          venceEn: { lt: ahora },
        },
        select: { id: true },
      });
      return { resultado: vencido ? AttendanceResult.PAQUETE_VENCIDO : AttendanceResult.SIN_PAQUETE };
    }

    const actualizados = await tx.patientPackage.updateMany({
      where: { id: paquete.id, sesionesRestantes: { gt: 0 } },
      data: { sesionesRestantes: { decrement: 1 } },
    });
    if (actualizados.count === 0) return { resultado: AttendanceResult.SIN_PAQUETE };

    return {
      resultado: AttendanceResult.OK,
      patientPackageId: paquete.id,
      sesionesRestantes: paquete.sesionesRestantes - 1,
      venceEn: paquete.venceEn,
    };
  }

  private async registrar(
    datos: {
      terminalId: string;
      resultado: AttendanceResult;
      uidLeido?: string;
      cardId?: string;
      patientId?: string | null;
      patientPackageId?: string;
      manual?: boolean;
      registradoPor?: string;
    },
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<CheckinResponse> {
    await tx.attendance.create({
      data: {
        terminalId: datos.terminalId,
        resultado: datos.resultado,
        uidLeido: datos.uidLeido,
        cardId: datos.cardId,
        patientId: datos.patientId ?? undefined,
        patientPackageId: datos.patientPackageId,
        manual: datos.manual ?? false,
        registradoPor: datos.registradoPor,
      },
    });

    return { ok: datos.resultado === AttendanceResult.OK, resultado: datos.resultado };
  }
}
