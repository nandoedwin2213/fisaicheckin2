import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttendanceResult, BillingMode, Equipment, Prisma, ServiceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashApiKey } from './terminal-key';
import { normalizarUid } from './uid';

export interface CheckinResponse {
  ok: boolean;
  resultado: AttendanceResult;
  paciente?: string;
  modo?: BillingMode;
  equipo?: string;
  sesionesRestantes?: number;
  creditosRestantes?: number;
  /** Segundos que el terminal debe mantener cerrado el relé. */
  duracionSegundos?: number;
  /** Presente solo en MINUTOS: el terminal lo devuelve en /checkin/fin. */
  usoId?: string;
  venceEn?: string;
}

export interface FinUsoResponse {
  ok: boolean;
  segundos: number;
  creditosCobrados: number;
  creditosRestantes: number;
}

interface ConsumoOk {
  resultado: typeof AttendanceResult.OK;
  patientPackageId: string;
  sesionesRestantes: number;
  creditosRestantes: number;
  venceEn: Date;
}

interface ConsumoFallido {
  resultado: Exclude<AttendanceResult, typeof AttendanceResult.OK>;
}

type Consumo = ConsumoOk | ConsumoFallido;

const SESIONES_POR_USO = 1;

@Injectable()
export class CheckinService {
  private readonly ventanaDuplicadoMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.ventanaDuplicadoMs = Number(config.get('DUPLICATE_WINDOW_SECONDS') ?? 60) * 1000;
  }

  /** Llamado por el ESP32: identifica al paciente por la tarjeta y cobra el uso. */
  async checkinPorTarjeta(uidCrudo: string, apiKey: string): Promise<CheckinResponse> {
    const terminal = await this.prisma.terminal.findUnique({
      where: { apiKeyHash: hashApiKey(apiKey) },
      include: { equipment: true },
    });
    if (!terminal || !terminal.activo) throw new UnauthorizedException('Terminal no autorizado');

    const uid = normalizarUid(uidCrudo);
    if (!uid) throw new BadRequestException('uid inválido');

    void this.prisma.terminal
      .update({ where: { id: terminal.id }, data: { ultimoVisto: new Date() } })
      .catch(() => undefined);

    if (terminal.equipment && !terminal.equipment.activo) {
      return this.sinId(
        await this.registrar({ terminalId: terminal.id, uidLeido: uid, resultado: AttendanceResult.EQUIPO_INACTIVO }),
      );
    }

    const card = await this.prisma.card.findUnique({ where: { uid } });

    if (!card) {
      return this.sinId(
        await this.registrar({
          terminalId: terminal.id,
          uidLeido: uid,
          resultado: AttendanceResult.TARJETA_DESCONOCIDA,
        }),
      );
    }
    if (!card.activa) {
      return this.sinId(
        await this.registrar({
          terminalId: terminal.id,
          uidLeido: uid,
          resultado: AttendanceResult.TARJETA_INACTIVA,
          cardId: card.id,
          patientId: card.patientId,
        }),
      );
    }
    if (!card.patientId) {
      return this.sinId(
        await this.registrar({
          terminalId: terminal.id,
          uidLeido: uid,
          resultado: AttendanceResult.TARJETA_SIN_PACIENTE,
          cardId: card.id,
        }),
      );
    }

    return this.procesar({
      terminalId: terminal.id,
      serviceType: terminal.equipment?.serviceType ?? terminal.serviceType,
      equipment: terminal.equipment,
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
    const terminal = await this.prisma.terminal.findUnique({ where: { id: terminalId }, include: { equipment: true } });
    if (!terminal || !terminal.activo) throw new NotFoundException('Terminal no encontrado');

    const patient = await this.prisma.patient.findUnique({ where: { cedula } });
    if (!patient || !patient.activo) {
      return this.sinId(
        await this.registrar({
          terminalId: terminal.id,
          resultado: AttendanceResult.PACIENTE_DESCONOCIDO,
          manual: true,
          registradoPor,
        }),
      );
    }

    return this.procesar({
      terminalId: terminal.id,
      serviceType: terminal.equipment?.serviceType ?? terminal.serviceType,
      equipment: terminal.equipment,
      patientId: patient.id,
      manual: true,
      registradoPor,
    });
  }

  /**
   * Cierre de un uso por minutos: el terminal avisa cuánto estuvo encendido el equipo y
   * recién ahí se cobran los créditos, redondeando hacia arriba al minuto.
   */
  async finalizarUso(usoId: string, segundosReportados: number, apiKey: string): Promise<FinUsoResponse> {
    const terminal = await this.prisma.terminal.findUnique({ where: { apiKeyHash: hashApiKey(apiKey) } });
    if (!terminal || !terminal.activo) throw new UnauthorizedException('Terminal no autorizado');

    const uso = await this.prisma.usage.findUnique({ where: { id: usoId }, include: { equipment: true } });
    if (!uso || uso.terminalId !== terminal.id) throw new NotFoundException('Uso no encontrado');
    if (uso.finEn) throw new BadRequestException('El uso ya fue cerrado');

    const segundos = Math.min(Math.max(segundosReportados, 0), uso.equipment.duracionSegundos);
    return this.cerrarUso(this.prisma, uso.id, segundos, false);
  }

  /**
   * Cobro y registro en una sola transacción: si el registro de asistencia falla,
   * lo consumido se revierte.
   */
  private async procesar(args: {
    terminalId: string;
    serviceType: ServiceType;
    equipment: Equipment | null;
    patientId: string;
    cardId?: string;
    uidLeido?: string;
    manual: boolean;
    registradoPor?: string;
  }): Promise<CheckinResponse> {
    const modo = args.equipment?.billingMode ?? BillingMode.SESIONES;

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
          return this.sinId(await this.registrar({ ...args, resultado: AttendanceResult.DUPLICADO }, tx));
        }
      }

      // Si el terminal se reinició sin reportar el fin, el uso anterior se cierra con el tope.
      if (modo === BillingMode.MINUTOS && args.equipment) {
        await this.cerrarUsosAbiertos(tx, args.patientId, args.equipment);
      }

      const consumo = await this.consumir(tx, args.patientId, args.serviceType, modo, args.equipment);
      const respuesta = await this.registrar(
        {
          ...args,
          resultado: consumo.resultado,
          patientPackageId: consumo.resultado === AttendanceResult.OK ? consumo.patientPackageId : undefined,
        },
        tx,
      );

      if (consumo.resultado !== AttendanceResult.OK) return this.sinId(respuesta);

      const patient = await tx.patient.findUniqueOrThrow({
        where: { id: args.patientId },
        select: { nombre: true },
      });

      const usoId =
        modo === BillingMode.MINUTOS && args.equipment
          ? (
              await tx.usage.create({
                data: {
                  attendanceId: respuesta.attendanceId,
                  patientId: args.patientId,
                  terminalId: args.terminalId,
                  equipmentId: args.equipment.id,
                  patientPackageId: consumo.patientPackageId,
                },
                select: { id: true },
              })
            ).id
          : undefined;

      return {
        ...this.sinId(respuesta),
        paciente: patient.nombre.split(' ')[0],
        modo,
        equipo: args.equipment?.nombre,
        sesionesRestantes: consumo.sesionesRestantes,
        creditosRestantes: consumo.creditosRestantes,
        duracionSegundos: args.equipment?.duracionSegundos,
        usoId,
        venceEn: consumo.venceEn.toISOString(),
      };
    });
  }

  /**
   * Elige el paquete vigente del mismo servicio que vence primero y lo descuenta con
   * `updateMany` condicionado al saldo, para que dos terminales simultáneos no puedan
   * gastar el mismo crédito. En MINUTOS no cobra: solo exige saldo para un minuto.
   */
  private async consumir(
    tx: Prisma.TransactionClient,
    patientId: string,
    serviceType: ServiceType,
    modo: BillingMode,
    equipment: Equipment | null,
  ): Promise<Consumo> {
    const ahora = new Date();
    const porSesiones = modo === BillingMode.SESIONES;
    const costo = porSesiones ? new Prisma.Decimal(0) : new Prisma.Decimal(equipment?.costo ?? 0);

    const saldoSuficiente: Prisma.PatientPackageWhereInput = porSesiones
      ? { sesionesRestantes: { gt: 0 } }
      : { creditosRestantes: { gte: costo } };

    const paquete = await tx.patientPackage.findFirst({
      where: {
        patientId,
        package: { serviceType, activo: true },
        venceEn: { gte: ahora },
        ...saldoSuficiente,
      },
      orderBy: { venceEn: 'asc' },
    });

    if (!paquete) {
      const vencido = await tx.patientPackage.findFirst({
        where: { patientId, package: { serviceType }, venceEn: { lt: ahora }, ...saldoSuficiente },
        select: { id: true },
      });
      if (vencido) return { resultado: AttendanceResult.PAQUETE_VENCIDO };

      const vigenteSinSaldo = await tx.patientPackage.findFirst({
        where: { patientId, package: { serviceType, activo: true }, venceEn: { gte: ahora } },
        select: { id: true },
      });
      return {
        resultado: vigenteSinSaldo && !porSesiones ? AttendanceResult.SIN_CREDITOS : AttendanceResult.SIN_PAQUETE,
      };
    }

    // En MINUTOS el cobro ocurre al cerrar el uso; aquí solo se reserva el paquete.
    const cobro: Prisma.PatientPackageUpdateManyMutationInput =
      modo === BillingMode.CREDITOS
        ? { creditosRestantes: { decrement: costo } }
        : porSesiones
          ? { sesionesRestantes: { decrement: SESIONES_POR_USO } }
          : {};

    if (Object.keys(cobro).length > 0) {
      const actualizados = await tx.patientPackage.updateMany({
        where: { id: paquete.id, ...saldoSuficiente },
        data: cobro,
      });
      if (actualizados.count === 0) {
        return { resultado: porSesiones ? AttendanceResult.SIN_PAQUETE : AttendanceResult.SIN_CREDITOS };
      }
    }

    return {
      resultado: AttendanceResult.OK,
      patientPackageId: paquete.id,
      sesionesRestantes: paquete.sesionesRestantes - (porSesiones ? SESIONES_POR_USO : 0),
      creditosRestantes: Number(
        modo === BillingMode.CREDITOS
          ? new Prisma.Decimal(paquete.creditosRestantes).minus(costo)
          : paquete.creditosRestantes,
      ),
      venceEn: paquete.venceEn,
    };
  }

  private async cerrarUsosAbiertos(
    tx: Prisma.TransactionClient,
    patientId: string,
    equipment: Equipment,
  ): Promise<void> {
    const abiertos = await tx.usage.findMany({
      where: { patientId, equipmentId: equipment.id, finEn: null },
      select: { id: true },
    });
    for (const { id } of abiertos) {
      await this.cerrarUso(tx, id, equipment.duracionSegundos, true);
    }
  }

  /** Cobra ceil(segundos/60) × costo del equipo, nunca más que el saldo disponible. */
  private async cerrarUso(
    tx: Prisma.TransactionClient,
    usoId: string,
    segundos: number,
    cerradoPorTope: boolean,
  ): Promise<FinUsoResponse> {
    const uso = await tx.usage.findUniqueOrThrow({ where: { id: usoId }, include: { equipment: true } });
    const minutos = Math.max(1, Math.ceil(segundos / 60));
    const bruto = new Prisma.Decimal(uso.equipment.costo).times(minutos);

    let cobrado = new Prisma.Decimal(0);
    let restante = new Prisma.Decimal(0);

    if (uso.patientPackageId) {
      const paquete = await tx.patientPackage.findUniqueOrThrow({ where: { id: uso.patientPackageId } });
      cobrado = Prisma.Decimal.min(bruto, paquete.creditosRestantes);
      await tx.patientPackage.update({
        where: { id: paquete.id },
        data: { creditosRestantes: { decrement: cobrado } },
      });
      restante = new Prisma.Decimal(paquete.creditosRestantes).minus(cobrado);
    }

    await tx.usage.update({
      where: { id: uso.id },
      data: { finEn: new Date(), segundos, creditosCobrados: cobrado, cerradoPorTope },
    });

    return {
      ok: true,
      segundos,
      creditosCobrados: Number(cobrado),
      creditosRestantes: Number(restante),
    };
  }

  /** El id de la asistencia es interno: solo lo usa `procesar` para enlazar el uso. */
  private sinId(registro: CheckinResponse & { attendanceId: string }): CheckinResponse {
    return { ok: registro.ok, resultado: registro.resultado };
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
  ): Promise<CheckinResponse & { attendanceId: string }> {
    const asistencia = await tx.attendance.create({
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
      select: { id: true },
    });

    return { ok: datos.resultado === AttendanceResult.OK, resultado: datos.resultado, attendanceId: asistencia.id };
  }
}
