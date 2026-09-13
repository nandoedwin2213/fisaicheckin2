# FISAI — Check-in por tarjeta RFID

Servicio independiente que registra la asistencia de pacientes, descuenta de su paquete (sesiones,
créditos o minutos) y activa el equipo cuando pasan la tarjeta por un terminal ESP32.

La tarjeta es **solo un identificador**: nunca guarda saldo ni datos clínicos. Toda lectura queda
registrada en `Attendance`, sea aceptada o rechazada, y esa tabla es la fuente de reportería.

- **Backend**: NestJS 10 + Prisma 5 + PostgreSQL
- **Terminal**: ESP32 + RC522 + relé (`firmware/fisai_terminal`)

## Modos de cobro

Un `Equipment` (sillón de masaje, caminadora, equipo de recuperación…) define la tarifa y cuántos
segundos cierra el relé. El terminal que lo controla apunta a él con `equipmentId`; un terminal sin
equipo funciona como control de acceso por sesiones.

| `billingMode` | Qué descuenta | Cuándo cobra |
|---|---|---|
| `SESIONES` | una sesión del paquete | al pasar la tarjeta |
| `CREDITOS` | `costo` créditos por uso | al pasar la tarjeta |
| `MINUTOS` | `costo` créditos por minuto | al cerrar el uso (`/checkin/fin`), redondeando hacia arriba |

En `MINUTOS` la respuesta trae un `usoId`; el terminal lo devuelve al apagar el equipo con los
segundos reales. Si nunca lo reporta (se reinició, se quedó sin red), el siguiente check-in de ese
paciente cierra el uso anterior cobrando el tope `duracionSegundos` y lo marca `cerradoPorTope`.

## Puesta en marcha

```bash
cp .env.example .env
docker compose up -d          # PostgreSQL en localhost:5433
npm install
npm run db:migrate
npm run db:seed               # terminal "Recepción", paciente de prueba y tarjeta A1B2C3D4
npm run start:dev
```

Prueba sin hardware:

```bash
curl -X POST http://localhost:3000/checkin \
  -H "Content-Type: application/json" \
  -H "X-Terminal-Key: clave-del-terminal" \
  -d '{"uid":"A1B2C3D4"}'
# {"ok":true,"resultado":"OK","paciente":"Ana","sesionesRestantes":9,"venceEn":"..."}
```

## API

| Método | Ruta | Autenticación | Uso |
|---|---|---|---|
| POST | `/checkin` | `X-Terminal-Key` (clave del terminal) | lo llama el ESP32 con el UID leído |
| POST | `/checkin/fin` | `X-Terminal-Key` | el ESP32 cierra un uso por minutos: `{ usoId, segundos }` |
| POST | `/checkin/manual` | `X-Staff-Key` (`STAFF_API_KEY`) | recepción, cuando el paciente olvidó la tarjeta |
| POST | `/recargas` | `X-Staff-Key` | caja: vende un paquete, `{ cedula, packageId, registradoPor? }` |
| GET | `/recargas/:cedula` | `X-Staff-Key` | saldo de sesiones y créditos del paciente |
| GET | `/admin/paquetes` | `X-Staff-Key` | catálogo de paquetes activos para el panel |
| GET | `/admin/terminales` | `X-Staff-Key` | terminales activos con su equipo (sin claves) |
| POST | `/admin/pacientes` | `X-Staff-Key` | alta de paciente: `{ cedula, nombre, uid? }` |
| POST | `/admin/pacientes/:cedula/tarjeta` | `X-Staff-Key` | enlaza una tarjeta: `{ uid }` |
| GET | `/health` | — | comprobación de vida y de conexión a la base |

`/checkin/manual` recibe `{ cedula, terminalId, registradoPor? }`. Identifica al paciente por cédula
sin pasar por la tarjeta, no aplica la ventana anti doble lectura y marca el registro con
`manual = true` y el usuario responsable.

## Panel de caja

En `/panel/index.html` (servido por el mismo backend) hay una página para recepción: buscar saldo por
cédula, vender un paquete, hacer check-in manual y dar de alta pacientes con su tarjeta.

La `STAFF_API_KEY` se escribe en la cabecera del panel y queda en `sessionStorage`, no en el HTML ni en
el servidor de estáticos: no se distribuye ninguna clave con la página. Al ser una clave compartida,
publica el panel solo en la red de la clínica o detrás de la autenticación de tu proxy.

## Resultados

| resultado | Feedback en el terminal | Acción en recepción |
|---|---|---|
| `OK` | verde + 1 beep | — |
| `SIN_PAQUETE` | rojo + 2 beeps | vender paquete |
| `PAQUETE_VENCIDO` | rojo + 2 beeps | renovar |
| `SIN_CREDITOS` | rojo + 2 beeps | recargar créditos |
| `EQUIPO_INACTIVO` | rojo + 2 beeps | el equipo está fuera de servicio |
| `TARJETA_DESCONOCIDA` | rojo + 2 beeps | registrar la tarjeta |
| `TARJETA_SIN_PACIENTE` | rojo + 2 beeps | asignar la tarjeta a un paciente |
| `TARJETA_INACTIVA` | rojo + 2 beeps | revisar el bloqueo |
| `DUPLICADO` | rojo + 2 beeps | lectura repetida < 60 s, ignorar |
| `PACIENTE_DESCONOCIDO` | — (solo manual) | verificar la cédula |
| sin WiFi / API caída | parpadeo alterno | la lectura queda encolada en el terminal y se reintenta |

## Garantías del descuento

- El paquete elegido es el **vigente del mismo `serviceType` que vence primero**.
- El decremento usa `updateMany` condicionado al saldo (`sesionesRestantes > 0` o
  `creditosRestantes >= costo`): dos terminales simultáneos no pueden gastar el mismo crédito.
- Un uso por minutos nunca cobra más créditos de los que quedan en el paquete.
- El descuento y el registro en `Attendance` ocurren **dentro de la misma transacción**: si el
  registro falla, la sesión vuelve al paquete.
- El UID se normaliza quitando separadores (`A1:B2:C3:D4`); si lo que queda no es hexadecimal se
  devuelve `400`, nunca se recorta la cadena hasta convertirla en el UID de otra tarjeta.

## Terminal (ESP32)

1. Arduino IDE → librerías **MFRC522** y **ArduinoJson**. Placa: ESP32 Dev Module.
2. En `firmware/fisai_terminal/fisai_terminal.ino` edita `WIFI_SSID`, `WIFI_PASS`, `API_URL`,
   `API_KEY` y pega el certificado raíz de tu servidor en `ROOT_CA`.
3. Cableado sin RC522: buzzer → GPIO4, LED verde → GPIO26, LED rojo → GPIO27 (cada LED con su
   resistencia a GND). Sube con `MODO_PRUEBA true` y presiona **BOOT** para simular una tarjeta.
4. Con RC522: SDA→5, SCK→18, MOSI→23, MISO→19, RST→22, 3.3 V, GND; cambia `MODO_PRUEBA` a `false`.
5. Relé (si el terminal activa un equipo): IN→GPIO25, VCC→5 V, GND→GND. Los módulos con
   optoacoplador activan en bajo (`RELE_ACTIVO_EN_BAJO`). Para cargas de 110/220 V usa un relé de
   estado sólido o un contactor dimensionado al equipo; el ESP32 nunca conmuta la carga directamente.

La `apiKey` se guarda **hasheada** (SHA-256) en la base; el texto plano solo vive en el firmware.
Para dar de alta un terminal, inserta `apiKeyHash = sha256(clave)` (ver `prisma/seed.ts`).

## Pruebas

```bash
docker compose up -d && npm run db:migrate
npm test        # unitarias + integración contra PostgreSQL real
npm run lint && npm run typecheck
```

Las pruebas de integración se omiten si no hay `DATABASE_URL`.

## Despliegue en Render

El repo trae `render.yaml` (Blueprint): en Render → **New → Blueprint** y eligiendo este repositorio
se crean el servicio web (Docker) y la base PostgreSQL, con `DATABASE_URL` enlazada y `STAFF_API_KEY`
generada automáticamente. El contenedor ejecuta `prisma migrate deploy` en cada arranque.

Después del primer despliegue, crea el terminal en la base (no hay seed en producción):

```bash
DATABASE_URL="<la externa de Render>" npm run terminal:add -- "Recepción" REHAB "TU-CLAVE"

# Equipo con tarifa + su terminal (el id del equipo lo imprime el primer comando)
DATABASE_URL="..." npm run equipment:add -- "Sillón de masaje" REHAB MINUTOS 0.50 1800
DATABASE_URL="..." npm run terminal:add -- "Sillón de masaje" REHAB "OTRA-CLAVE" <equipmentId>
```

Luego en el firmware solo queda poner `API_KEY = "TU-CLAVE"`: `API_URL` ya apunta al servicio desplegado
y `ROOT_CA` trae el raíz con el que Render emite hoy (GTS Root R4, Google Trust Services).

> El plan free de Render suspende el servicio tras inactividad: el primer check-in del día puede
> tardar ~30 s en responder. La cola offline del terminal reintenta, pero para uso real conviene
> el plan de pago.

## Integración con FISAI Flow

Este servicio es autónomo y se conecta a su propia base. Si se quiere fusionar con la base de FISAI
Flow, `Patient` debe apuntar a la tabla existente y el resto de modelos se añaden tal cual; en ese
caso sustituye `StaffGuard` por el guard de usuario de Flow.
