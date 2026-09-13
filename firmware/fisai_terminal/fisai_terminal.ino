/*
 * FISAI Terminal de check-in — ESP32 + RC522 + LEDs + buzzer
 *
 * MODO_PRUEBA = true  → no usa el RC522 (sirve sin soldar): el botón BOOT envía UID_PRUEBA.
 * MODO_PRUEBA = false → lee tarjetas reales con el RC522.
 *
 * Diferencias con el prototipo:
 *  - Verifica el certificado del servidor (ROOT_CA) en vez de client.setInsecure().
 *  - Cola offline en NVS: si no hay WiFi o la API falla, la lectura se guarda y se reintenta.
 *
 * Librerías: MFRC522 (GithubCommunity), ArduinoJson (Benoit Blanchon)
 * Placa: ESP32 Dev Module
 */

#define MODO_PRUEBA true
#define UID_PRUEBA  "A1B2C3D4"

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#if !MODO_PRUEBA
  #include <SPI.h>
  #include <MFRC522.h>
#endif

// ---------- Configuración ----------
const char* WIFI_SSID = "TU_WIFI";
const char* WIFI_PASS = "TU_CLAVE";
const char* API_URL   = "https://TU-API.example.com/checkin";
const char* API_KEY   = "clave-del-terminal";   // texto plano; en la base vive su hash SHA-256

// Certificado raíz del emisor del servidor (ej. ISRG Root X1 para Let's Encrypt).
// Reemplázalo por el de tu proveedor: sin esto la apiKey viaja sin verificar al servidor.
const char* ROOT_CA = R"(-----BEGIN CERTIFICATE-----
PEGA_AQUI_EL_CERTIFICADO_RAIZ
-----END CERTIFICATE-----
)";

// ---------- Pines ----------
#define SS_PIN   5
#define RST_PIN  22
#define BUZZER   4
#define LED_OK   26
#define LED_NO   27
#define BTN_BOOT 0

#if !MODO_PRUEBA
  MFRC522 rfid(SS_PIN, RST_PIN);
#endif

Preferences cola;                       // cola offline persistente
const int   COLA_MAX = 20;
const unsigned long REINTENTO_MS = 30000;
unsigned long ultimoReintento = 0;

// ---------- Feedback ----------
void beep(int ms) { digitalWrite(BUZZER, HIGH); delay(ms); digitalWrite(BUZZER, LOW); }

void feedbackOk() { digitalWrite(LED_OK, HIGH); beep(120); delay(900); digitalWrite(LED_OK, LOW); }

void feedbackNo() {
  digitalWrite(LED_NO, HIGH); beep(300); delay(150); beep(300); delay(400); digitalWrite(LED_NO, LOW);
}

void feedbackEncolado() {               // sin WiFi / API caída: parpadeo alterno
  for (int i = 0; i < 3; i++) {
    digitalWrite(LED_OK, HIGH); digitalWrite(LED_NO, LOW); delay(150);
    digitalWrite(LED_OK, LOW);  digitalWrite(LED_NO, HIGH); delay(150);
  }
  digitalWrite(LED_NO, LOW);
}

// ---------- Cola offline ----------
int colaTam() { return cola.getInt("n", 0); }

void colaGuardar(const String& uid) {
  int n = colaTam();
  if (n >= COLA_MAX) { Serial.println("Cola llena, se descarta la lectura mas antigua"); return; }
  cola.putString(("u" + String(n)).c_str(), uid);
  cola.putInt("n", n + 1);
  Serial.printf("Encolado (%d pendientes)\n", n + 1);
}

void colaQuitarPrimero() {
  int n = colaTam();
  for (int i = 1; i < n; i++) {
    cola.putString(("u" + String(i - 1)).c_str(), cola.getString(("u" + String(i)).c_str(), ""));
  }
  if (n > 0) { cola.remove(("u" + String(n - 1)).c_str()); cola.putInt("n", n - 1); }
}

// ---------- WiFi ----------
void conectarWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Conectando WiFi");
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) { delay(300); Serial.print("."); }
  Serial.println(WiFi.status() == WL_CONNECTED ? " OK " + WiFi.localIP().toString() : " FALLO");
}

// ---------- Envío ----------
// Devuelve true si el servidor respondió (aceptando o rechazando); false si hay que reintentar.
bool enviarCheckin(const String& uid, bool mostrarFeedback) {
  conectarWifi();
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setCACert(ROOT_CA);
  HTTPClient http;
  if (!http.begin(client, API_URL)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Terminal-Key", API_KEY);
  http.setTimeout(8000);

  String body = "{\"uid\":\"" + uid + "\"}";
  int code = http.POST(body);
  String resp = http.getString();
  http.end();

  Serial.printf("HTTP %d: %s\n", code, resp.c_str());
  if (code < 200 || code >= 300) return false;

  StaticJsonDocument<384> doc;
  if (deserializeJson(doc, resp)) return false;

  bool ok = doc["ok"] | false;
  if (mostrarFeedback) {
    if (ok) {
      Serial.printf("OK %s — quedan %d sesiones\n", doc["paciente"] | "", doc["sesionesRestantes"] | 0);
      feedbackOk();
    } else {
      Serial.printf("RECHAZADO: %s\n", doc["resultado"] | "?");
      feedbackNo();
    }
  }
  return true;
}

void procesarLectura(const String& uid) {
  if (!enviarCheckin(uid, true)) { colaGuardar(uid); feedbackEncolado(); }
}

void vaciarCola() {
  if (colaTam() == 0 || millis() - ultimoReintento < REINTENTO_MS) return;
  ultimoReintento = millis();
  while (colaTam() > 0) {
    String uid = cola.getString("u0", "");
    if (uid.isEmpty()) { colaQuitarPrimero(); continue; }
    if (!enviarCheckin(uid, false)) return;   // sigue sin línea: se reintenta luego
    colaQuitarPrimero();
  }
  Serial.println("Cola vaciada");
}

// ---------- Setup / loop ----------
void setup() {
  Serial.begin(115200);
  pinMode(BUZZER, OUTPUT); pinMode(LED_OK, OUTPUT); pinMode(LED_NO, OUTPUT);
  pinMode(BTN_BOOT, INPUT_PULLUP);
  cola.begin("checkin", false);

#if !MODO_PRUEBA
  SPI.begin();
  rfid.PCD_Init();
#endif

  conectarWifi();
  beep(60); delay(60); beep(60);
  Serial.println(MODO_PRUEBA ? "MODO PRUEBA: presiona BOOT para simular tarjeta"
                             : "Acerca una tarjeta...");
}

void loop() {
  vaciarCola();

#if MODO_PRUEBA
  if (digitalRead(BTN_BOOT) == LOW) {
    delay(50);
    if (digitalRead(BTN_BOOT) == LOW) {
      procesarLectura(UID_PRUEBA);
      while (digitalRead(BTN_BOOT) == LOW) delay(10);
    }
  }
#else
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  String uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uid += "0";
    uid += String(rfid.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  Serial.println("UID: " + uid);
  procesarLectura(uid);
  delay(1500);
#endif
}
