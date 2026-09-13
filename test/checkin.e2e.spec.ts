/**
 * Pruebas de integración contra PostgreSQL real (docker compose up -d && npm run db:migrate).
 * Se omiten si no hay DATABASE_URL configurada.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AttendanceResult, BillingMode, ServiceType } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashApiKey } from '../src/checkin/terminal-key';
import { PrismaService } from '../src/prisma/prisma.service';

const TERMINAL_KEY = 'clave-test';
const EQUIPO_KEY = 'clave-equipo-test';
const STAFF_KEY = 'staff-test';
const UID = 'A1B2C3D4';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('Check-in (integración)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let terminalId: string;
  let patientId: string;
  let packageId: string;

  beforeAll(async () => {
    process.env.STAFF_API_KEY = STAFF_KEY;
    process.env.DUPLICATE_WINDOW_SECONDS = '60';
    process.env.RATE_LIMIT = '1000';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
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

    terminalId = (
      await prisma.terminal.create({
        data: { nombre: 'Recepción', serviceType: ServiceType.REHAB, apiKeyHash: hashApiKey(TERMINAL_KEY) },
      })
    ).id;
    patientId = (await prisma.patient.create({ data: { cedula: '1712345678', nombre: 'Ana Pérez' } })).id;
    packageId = (
      await prisma.package.create({
        data: { nombre: '10 sesiones', sesiones: 10, vigenciaDias: 60, precio: 150, serviceType: ServiceType.REHAB },
      })
    ).id;
    await prisma.card.create({ data: { uid: UID, patientId } });
  });

  afterAll(async () => {
    await app.close();
  });

  const darPaquete = (sesiones: number, diasVigencia: number, creditos = 0) =>
    prisma.patientPackage.create({
      data: {
        patientId,
        packageId,
        sesionesRestantes: sesiones,
        creditosRestantes: creditos,
        venceEn: new Date(Date.now() + diasVigencia * 86_400_000),
      },
    });

  /** Terminal atado a un equipo con su tarifa, como el sillón o la caminadora. */
  const darEquipo = async (billingMode: BillingMode, costo: number, duracionSegundos = 1800) => {
    const equipo = await prisma.equipment.create({
      data: { nombre: 'Sillón', serviceType: ServiceType.REHAB, billingMode, costo, duracionSegundos },
    });
    const terminal = await prisma.terminal.create({
      data: {
        nombre: 'Sillón',
        serviceType: ServiceType.REHAB,
        apiKeyHash: hashApiKey(EQUIPO_KEY),
        equipmentId: equipo.id,
      },
    });
    return { equipo, terminal };
  };

  const creditos = async () =>
    Number((await prisma.patientPackage.findFirstOrThrow({ where: { patientId } })).creditosRestantes);

  const porTarjeta = (uid: string = UID, key: string = TERMINAL_KEY) =>
    request(app.getHttpServer()).post('/checkin').set('X-Terminal-Key', key).send({ uid });

  it('descuenta una sesión y devuelve el saldo', async () => {
    await darPaquete(10, 30);

    const res = await porTarjeta().expect(201);

    expect(res.body).toMatchObject({ ok: true, resultado: 'OK', paciente: 'Ana', sesionesRestantes: 9 });
    const [asistencia] = await prisma.attendance.findMany();
    expect(asistencia).toMatchObject({ resultado: AttendanceResult.OK, manual: false, uidLeido: UID, patientId });
  });

  it('rechaza la segunda lectura dentro de la ventana sin descontar', async () => {
    await darPaquete(10, 30);
    await porTarjeta().expect(201);

    const res = await porTarjeta().expect(201);

    expect(res.body.resultado).toBe('DUPLICADO');
    const paquete = await prisma.patientPackage.findFirstOrThrow({ where: { patientId } });
    expect(paquete.sesionesRestantes).toBe(9);
  });

  it('distingue paquete vencido de ausencia de paquete', async () => {
    expect((await porTarjeta()).body.resultado).toBe('SIN_PAQUETE');

    await darPaquete(5, -1);
    expect((await porTarjeta()).body.resultado).toBe('PAQUETE_VENCIDO');
  });

  it('registra la lectura de una tarjeta desconocida sin tocar paquetes', async () => {
    const res = await porTarjeta('FFFFFFFF').expect(201);
    expect(res.body).toEqual({ ok: false, resultado: 'TARJETA_DESCONOCIDA' });
    expect(await prisma.attendance.count({ where: { uidLeido: 'FFFFFFFF' } })).toBe(1);
  });

  it('no acepta un terminal con clave inválida', async () => {
    await porTarjeta(UID, 'clave-que-no-existe').expect(401);
  });

  it('exige credencial de recepción en el check-in manual', async () => {
    await request(app.getHttpServer()).post('/checkin/manual').send({ cedula: '1712345678', terminalId }).expect(401);
  });

  it('registra el check-in manual por cédula aunque el paciente no traiga tarjeta', async () => {
    await darPaquete(10, 30);
    await prisma.card.deleteMany();

    const res = await request(app.getHttpServer())
      .post('/checkin/manual')
      .set('X-Staff-Key', STAFF_KEY)
      .send({ cedula: '1712345678', terminalId, registradoPor: 'recepcion@fisai' })
      .expect(201);

    expect(res.body).toMatchObject({ ok: true, resultado: 'OK', sesionesRestantes: 9 });
    const [asistencia] = await prisma.attendance.findMany();
    expect(asistencia).toMatchObject({ manual: true, registradoPor: 'recepcion@fisai', uidLeido: null, patientId });
  });

  it('el manual no queda bloqueado por la ventana anti duplicado de la tarjeta', async () => {
    await darPaquete(10, 30);
    await porTarjeta().expect(201);

    const res = await request(app.getHttpServer())
      .post('/checkin/manual')
      .set('X-Staff-Key', STAFF_KEY)
      .send({ cedula: '1712345678', terminalId })
      .expect(201);

    expect(res.body).toMatchObject({ ok: true, sesionesRestantes: 8 });
  });

  it('rechaza un uid que no es hexadecimal en vez de normalizarlo a otra tarjeta', async () => {
    await prisma.card.create({ data: { uid: 'AAAAAAAA', patientId } });
    await porTarjeta('MANUALMA').expect(400);
  });

  it('un equipo por créditos cobra su tarifa y deja las sesiones intactas', async () => {
    await darPaquete(10, 30, 5);
    await darEquipo(BillingMode.CREDITOS, 1.5);

    const res = await porTarjeta(UID, EQUIPO_KEY).expect(201);

    expect(res.body).toMatchObject({
      ok: true,
      modo: 'CREDITOS',
      equipo: 'Sillón',
      creditosRestantes: 3.5,
      duracionSegundos: 1800,
    });
    const paquete = await prisma.patientPackage.findFirstOrThrow({ where: { patientId } });
    expect(paquete.sesionesRestantes).toBe(10);
  });

  it('distingue quedarse sin créditos de no tener paquete', async () => {
    await darPaquete(10, 30, 1);
    await darEquipo(BillingMode.CREDITOS, 1.5);

    expect((await porTarjeta(UID, EQUIPO_KEY)).body.resultado).toBe('SIN_CREDITOS');
    expect(await creditos()).toBe(1);
  });

  it('un equipo por minutos no cobra al iniciar y cobra al cerrar el uso', async () => {
    await darPaquete(10, 30, 10);
    await darEquipo(BillingMode.MINUTOS, 0.5);

    const inicio = await porTarjeta(UID, EQUIPO_KEY).expect(201);
    expect(inicio.body).toMatchObject({ ok: true, modo: 'MINUTOS', duracionSegundos: 1800 });
    expect(inicio.body.usoId).toEqual(expect.any(String));
    expect(await creditos()).toBe(10);

    // 605 s → 11 minutos × 0,50 = 5,50
    const fin = await request(app.getHttpServer())
      .post('/checkin/fin')
      .set('X-Terminal-Key', EQUIPO_KEY)
      .send({ usoId: inicio.body.usoId, segundos: 605 })
      .expect(201);

    expect(fin.body).toMatchObject({ ok: true, creditosCobrados: 5.5, creditosRestantes: 4.5 });
    expect(await creditos()).toBe(4.5);
  });

  it('no deja cerrar dos veces el mismo uso ni cerrarlo desde otro terminal', async () => {
    await darPaquete(10, 30, 10);
    await darEquipo(BillingMode.MINUTOS, 0.5);
    const { body } = await porTarjeta(UID, EQUIPO_KEY).expect(201);

    await request(app.getHttpServer())
      .post('/checkin/fin')
      .set('X-Terminal-Key', TERMINAL_KEY)
      .send({ usoId: body.usoId, segundos: 60 })
      .expect(404);

    await request(app.getHttpServer())
      .post('/checkin/fin')
      .set('X-Terminal-Key', EQUIPO_KEY)
      .send({ usoId: body.usoId, segundos: 60 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/checkin/fin')
      .set('X-Terminal-Key', EQUIPO_KEY)
      .send({ usoId: body.usoId, segundos: 60 })
      .expect(400);
  });

  it('cierra con el tope el uso que el terminal nunca reportó', async () => {
    process.env.DUPLICATE_WINDOW_SECONDS = '60';
    await darPaquete(10, 30, 100);
    await darEquipo(BillingMode.MINUTOS, 1, 600);

    const primero = await porTarjeta(UID, EQUIPO_KEY).expect(201);
    // Envejece la lectura para salir de la ventana anti duplicado, como si fuera otro día.
    await prisma.attendance.updateMany({
      where: { resultado: AttendanceResult.OK },
      data: { createdAt: new Date(Date.now() - 3_600_000) },
    });
    await porTarjeta(UID, EQUIPO_KEY).expect(201);

    const uso = await prisma.usage.findUniqueOrThrow({ where: { id: primero.body.usoId } });
    expect(uso).toMatchObject({ cerradoPorTope: true, segundos: 600 });
    expect(Number(uso.creditosCobrados)).toBe(10);
  });

  it('no cobra más créditos de los que quedan en el paquete', async () => {
    await darPaquete(10, 30, 2);
    await darEquipo(BillingMode.MINUTOS, 1);
    const { body } = await porTarjeta(UID, EQUIPO_KEY).expect(201);

    const fin = await request(app.getHttpServer())
      .post('/checkin/fin')
      .set('X-Terminal-Key', EQUIPO_KEY)
      .send({ usoId: body.usoId, segundos: 600 })
      .expect(201);

    expect(fin.body).toMatchObject({ creditosCobrados: 2, creditosRestantes: 0 });
  });

  it('la recarga en caja crea el paquete con sesiones y créditos y queda auditada', async () => {
    await prisma.package.update({ where: { id: packageId }, data: { creditos: 20 } });

    await request(app.getHttpServer()).post('/recargas').send({ cedula: '1712345678', packageId }).expect(401);

    const res = await request(app.getHttpServer())
      .post('/recargas')
      .set('X-Staff-Key', STAFF_KEY)
      .send({ cedula: '1712345678', packageId, registradoPor: 'caja@fisai' })
      .expect(201);

    expect(res.body).toMatchObject({ ok: true, sesionesRestantes: 10, creditosRestantes: 20 });
    const [recarga] = await prisma.recharge.findMany();
    expect(recarga).toMatchObject({ registradoPor: 'caja@fisai', sesiones: 10 });

    const saldo = await request(app.getHttpServer())
      .get('/recargas/1712345678')
      .set('X-Staff-Key', STAFF_KEY)
      .expect(200);
    expect(saldo.body.paquetes).toHaveLength(1);
    expect(saldo.body.paquetes[0]).toMatchObject({ creditosRestantes: 20, vigente: true });
  });

  it('consume primero el paquete que vence antes', async () => {
    const largo = await darPaquete(5, 60);
    const corto = await darPaquete(5, 2);

    await porTarjeta().expect(201);

    expect((await prisma.patientPackage.findUniqueOrThrow({ where: { id: corto.id } })).sesionesRestantes).toBe(4);
    expect((await prisma.patientPackage.findUniqueOrThrow({ where: { id: largo.id } })).sesionesRestantes).toBe(5);
  });
});
