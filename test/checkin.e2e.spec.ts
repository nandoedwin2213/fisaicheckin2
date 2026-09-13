/**
 * Pruebas de integración contra PostgreSQL real (docker compose up -d && npm run db:migrate).
 * Se omiten si no hay DATABASE_URL configurada.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AttendanceResult, ServiceType } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashApiKey } from '../src/checkin/terminal-key';
import { PrismaService } from '../src/prisma/prisma.service';

const TERMINAL_KEY = 'clave-test';
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

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.attendance.deleteMany();
    await prisma.patientPackage.deleteMany();
    await prisma.card.deleteMany();
    await prisma.package.deleteMany();
    await prisma.patient.deleteMany();
    await prisma.terminal.deleteMany();

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

  const darPaquete = (sesiones: number, diasVigencia: number) =>
    prisma.patientPackage.create({
      data: {
        patientId,
        packageId,
        sesionesRestantes: sesiones,
        venceEn: new Date(Date.now() + diasVigencia * 86_400_000),
      },
    });

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

  it('consume primero el paquete que vence antes', async () => {
    const largo = await darPaquete(5, 60);
    const corto = await darPaquete(5, 2);

    await porTarjeta().expect(201);

    expect((await prisma.patientPackage.findUniqueOrThrow({ where: { id: corto.id } })).sesionesRestantes).toBe(4);
    expect((await prisma.patientPackage.findUniqueOrThrow({ where: { id: largo.id } })).sesionesRestantes).toBe(5);
  });
});
