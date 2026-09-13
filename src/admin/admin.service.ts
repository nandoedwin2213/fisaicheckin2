import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizarUid } from '../checkin/uid';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async paquetes() {
    const paquetes = await this.prisma.package.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } });
    return paquetes.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      serviceType: p.serviceType,
      sesiones: p.sesiones,
      creditos: Number(p.creditos),
      precio: Number(p.precio),
      vigenciaDias: p.vigenciaDias,
    }));
  }

  /** Los terminales que recepción puede elegir para un check-in manual; nunca expone la apiKey. */
  async terminales() {
    const terminales = await this.prisma.terminal.findMany({
      where: { activo: true },
      include: { equipment: true },
      orderBy: { nombre: 'asc' },
    });
    return terminales.map((t) => ({
      id: t.id,
      nombre: t.nombre,
      serviceType: t.serviceType,
      equipo: t.equipment?.nombre ?? null,
      modo: t.equipment?.billingMode ?? null,
    }));
  }

  /** El paciente y su tarjeta se crean juntos: un UID ocupado no debe dejar al paciente a medio dar de alta. */
  async crearPaciente(cedula: string, nombre: string, uidCrudo?: string) {
    let uid: string | null = null;
    if (uidCrudo) {
      uid = normalizarUid(uidCrudo);
      if (!uid) throw new BadRequestException('UID inválido');
    }

    const patient = await this.prisma.$transaction(async (tx) => {
      if (await tx.patient.findUnique({ where: { cedula } })) {
        throw new ConflictException('Ya existe un paciente con esa cédula');
      }
      if (uid && (await tx.card.findUnique({ where: { uid } }))) {
        throw new ConflictException('Esa tarjeta ya está asignada a otro paciente');
      }

      const creado = await tx.patient.create({ data: { cedula, nombre } });
      if (uid) await tx.card.create({ data: { uid, patientId: creado.id } });
      return creado;
    });

    return { ok: true, id: patient.id, cedula, nombre: patient.nombre, uid };
  }

  async asignarTarjeta(cedula: string, uidCrudo: string) {
    const uid = normalizarUid(uidCrudo);
    if (!uid) throw new BadRequestException('UID inválido');

    const patient = await this.prisma.patient.findUnique({ where: { cedula } });
    if (!patient) throw new NotFoundException('Paciente no encontrado');

    const existente = await this.prisma.card.findUnique({ where: { uid } });
    if (existente && existente.patientId !== patient.id) {
      throw new ConflictException('Esa tarjeta ya está asignada a otro paciente');
    }

    const card = await this.prisma.card.upsert({
      where: { uid },
      update: { activa: true },
      create: { uid, patientId: patient.id },
    });
    return { ok: true, uid: card.uid, paciente: patient.nombre };
  }
}
