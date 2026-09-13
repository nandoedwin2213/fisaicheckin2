/**
 * Pruebas de integración de los endpoints que consume el panel de caja.
 * Se omiten si no hay DATABASE_URL configurada.
 */
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { BillingMode, ServiceType } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashApiKey } from '../src/checkin/terminal-key';
import { PrismaService } from '../src/prisma/prisma.service';
import { configurarApp } from '../src/setup';

const STAFF_KEY = 'staff-test';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('Panel de caja (integración)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.STAFF_API_KEY = STAFF_KEY;
    process.env.RATE_LIMIT = '1000';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configurarApp(app);
    await app.init();

    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.usage.deleteMany();
    await prisma.recharge.deleteMany();
    await prisma.attendance.deleteMany();
    await prisma.patientPackage.deleteMany();
    await prisma.card.deleteMany();
    await prisma.package.deleteMany();
    await prisma.patient.deleteMany();
    await prisma.terminal.deleteMany();
    await prisma.equipment.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const conClave = (metodo: 'get' | 'post', ruta: string) =>
    request(app.getHttpServer())[metodo](ruta).set('X-Staff-Key', STAFF_KEY);

  it('exige X-Staff-Key en todo el panel', async () => {
    await request(app.getHttpServer()).get('/admin/paquetes').expect(401);
    await request(app.getHttpServer()).get('/admin/terminales').expect(401);
    await request(app.getHttpServer()).post('/admin/pacientes').send({ cedula: '1712345678', nombre: 'Ana' }).expect(401);
  });

  it('lista los paquetes y terminales activos sin exponer la clave del terminal', async () => {
    await prisma.package.create({
      data: { nombre: '10 sesiones', sesiones: 10, creditos: 20, vigenciaDias: 60, precio: 150, serviceType: ServiceType.REHAB },
    });
    await prisma.package.create({
      data: { nombre: 'Retirado', sesiones: 1, vigenciaDias: 1, precio: 1, serviceType: ServiceType.REHAB, activo: false },
    });
    const equipo = await prisma.equipment.create({
      data: {
        nombre: 'Sillón',
        serviceType: ServiceType.REHAB,
        billingMode: BillingMode.MINUTOS,
        costo: 0.5,
        duracionSegundos: 1800,
      },
    });
    await prisma.terminal.create({
      data: {
        nombre: 'Sillón',
        serviceType: ServiceType.REHAB,
        apiKeyHash: hashApiKey('clave-equipo'),
        equipmentId: equipo.id,
      },
    });

    const paquetes = await conClave('get', '/admin/paquetes').expect(200);
    expect(paquetes.body).toHaveLength(1);
    expect(paquetes.body[0]).toMatchObject({ nombre: '10 sesiones', sesiones: 10, creditos: 20, precio: 150 });

    const terminales = await conClave('get', '/admin/terminales').expect(200);
    expect(terminales.body[0]).toMatchObject({ nombre: 'Sillón', equipo: 'Sillón', modo: 'MINUTOS' });
    expect(JSON.stringify(terminales.body)).not.toContain('apiKey');
  });

  it('crea el paciente con su tarjeta y normaliza el UID', async () => {
    const res = await conClave('post', '/admin/pacientes')
      .send({ cedula: '1712345678', nombre: 'Ana Pérez', uid: 'a1:b2:c3:d4' })
      .expect(201);

    expect(res.body).toMatchObject({ ok: true, uid: 'A1B2C3D4' });
    const card = await prisma.card.findUniqueOrThrow({ where: { uid: 'A1B2C3D4' } });
    expect(card.patientId).toBe(res.body.id);
  });

  it('no duplica cédulas ni roba la tarjeta de otro paciente', async () => {
    await conClave('post', '/admin/pacientes').send({ cedula: '1712345678', nombre: 'Ana', uid: 'A1B2C3D4' }).expect(201);
    await conClave('post', '/admin/pacientes').send({ cedula: '1712345678', nombre: 'Otra' }).expect(409);

    await conClave('post', '/admin/pacientes').send({ cedula: '1798765432', nombre: 'Luis' }).expect(201);
    await conClave('post', '/admin/pacientes/1798765432/tarjeta').send({ uid: 'A1B2C3D4' }).expect(409);

    const card = await prisma.card.findUniqueOrThrow({ where: { uid: 'A1B2C3D4' }, include: { patient: true } });
    expect(card.patient?.nombre).toBe('Ana');
  });

  it('rechaza un UID que no es hexadecimal', async () => {
    await conClave('post', '/admin/pacientes').send({ cedula: '1712345678', nombre: 'Ana', uid: 'ZZZZZZZZ' }).expect(400);
    expect(await prisma.patient.count()).toBe(0);
  });

  it('sirve el panel estático en /panel', async () => {
    const res = await request(app.getHttpServer()).get('/panel/index.html').expect(200);
    expect(res.text).toContain('FISAI — Caja');
  });
});
