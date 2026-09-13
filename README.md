# FISAI — Check-in por tarjeta RFID

Servicio independiente que registra la asistencia de pacientes y descuenta sesiones de su paquete
cuando pasan la tarjeta por un terminal ESP32.

La tarjeta es **solo un identificador**: nunca guarda saldo ni datos clínicos. Toda lectura queda
registrada en `Attendance`, sea aceptada o rechazada, y esa tabla es la fuente de reportería.

- **Backend**: NestJS 10 + Prisma 5 + PostgreSQL
- **Terminal**: ESP32 + RC522 (`firmware/fisai_terminal`)

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
| POST | `/checkin/manual` | `X-Staff-Key` (`STAFF_API_KEY`) | recepción, cuando el paciente olvidó la tarjeta |
| GET | `/health` | — | comprobación de vida y de conexión a la base |

`/checkin/manual` recibe `{ cedula, terminalId, registradoPor? }`. Identifica al paciente por cédula
sin pasar por la tarjeta, no aplica la ventana anti doble lectura y marca el registro con
`manual = true` y el usuario responsable.

## Resultados

| resultado | Feedback en el terminal | Acción en recepción |
|---|---|---|
| `OK` | verde + 1 beep | — |
| `SIN_PAQUETE` | rojo + 2 beeps | vender paquete |
| `PAQUETE_VENCIDO` | rojo + 2 beeps | renovar |
| `TARJETA_DESCONOCIDA` | rojo + 2 beeps | registrar la tarjeta |
| `TARJETA_SIN_PACIENTE` | rojo + 2 beeps | asignar la tarjeta a un paciente |
| `TARJETA_INACTIVA` | rojo + 2 beeps | revisar el bloqueo |
| `DUPLICADO` | rojo + 2 beeps | lectura repetida < 60 s, ignorar |
| `PACIENTE_DESCONOCIDO` | — (solo manual) | verificar la cédula |
| sin WiFi / API caída | parpadeo alterno | la lectura queda encolada en el terminal y se reintenta |

## Garantías del descuento

- El paquete elegido es el **vigente del mismo `serviceType` que vence primero**.
- El decremento usa `updateMany` condicionado a `sesionesRestantes > 0`: dos terminales simultáneos
  no pueden gastar el mismo crédito.
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
