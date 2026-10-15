/*
  ORCAS sensor node - reference firmware for ESP32 (Arduino core).
  Sends cold box / cold store readings to the ORCAS server every 10 seconds and
  follows the setpoint returned by the server with a simple hysteresis relay.

  Parts (matches the prototype bill of materials):
    ESP32 dev board, DHT22 (temperature + humidity), magnetic reed switch (door),
    relay module (compressor / cooling), voltage divider on battery (ADC)

  Libraries (Arduino Library Manager): "DHT sensor library" by Adafruit, "Adafruit Unified Sensor"

  IMPORTANT: verify pin numbers and the battery divider ratio against your own wiring before use.
  The server marks the unit as "Live sensor" while readings keep arriving, and falls back to
  simulation automatically if the node goes quiet for 90 seconds.
*/
#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>

// ---- edit these ----
const char* WIFI_SSID   = "YOUR_WIFI_NAME";
const char* WIFI_PASS   = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL  = "http://192.168.1.50:3000/api/ingest";  // your computer's / server's address
const char* INGEST_KEY  = "orcas-demo-key";                        // must match INGEST_KEY on the server
const char* UNIT_ID     = "ORC-S1";                                // unit this node reports for
// --------------------

#define DHT_PIN      4
#define DOOR_PIN     27      // reed switch to GND, internal pull-up: LOW = door closed
#define RELAY_PIN    26      // active HIGH = compressor ON
#define BATT_PIN     34      // ADC1 channel, through a divider (R1 = 100k, R2 = 33k)
const float BATT_DIV    = (100.0 + 33.0) / 33.0;
const float BATT_EMPTY  = 10.5;   // volts at 0 % (12 V lead-acid / LiFePO4 pack, adjust)
const float BATT_FULL   = 13.2;   // volts at 100 %
const unsigned long SEND_EVERY_MS = 10000;
const float HYST = 0.5;           // degrees C either side of the setpoint

DHT dht(DHT_PIN, DHT22);
float setpointC = 2.0;
bool compressorOn = false;
unsigned long lastSend = 0;

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) delay(250);
}

float batteryPercent() {
  float volts = analogReadMilliVolts(BATT_PIN) / 1000.0 * BATT_DIV;
  float pct = (volts - BATT_EMPTY) / (BATT_FULL - BATT_EMPTY) * 100.0;
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return pct;
}

void setup() {
  Serial.begin(115200);
  pinMode(DOOR_PIN, INPUT_PULLUP);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  dht.begin();
  connectWifi();
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  // Local control keeps working even if Wi-Fi or the server is down.
  if (!isnan(t)) {
    if (t > setpointC + HYST) compressorOn = true;
    else if (t < setpointC - HYST) compressorOn = false;
    digitalWrite(RELAY_PIN, compressorOn ? HIGH : LOW);
  } else {
    digitalWrite(RELAY_PIN, LOW);   // sensor fault: fail safe, do not run blind
    compressorOn = false;
  }

  if (millis() - lastSend >= SEND_EVERY_MS) {
    lastSend = millis();
    connectWifi();
    if (WiFi.status() == WL_CONNECTED && !isnan(t)) {
      bool doorOpen = digitalRead(DOOR_PIN) == HIGH;
      char body[256];
      snprintf(body, sizeof(body),
        "{\"unitId\":\"%s\",\"tempC\":%.2f,\"rh\":%.1f,\"doorOpen\":%s,\"compressorOn\":%s,\"batteryPct\":%.0f}",
        UNIT_ID, t, isnan(h) ? 0.0f : h, doorOpen ? "true" : "false", compressorOn ? "true" : "false", batteryPercent());

      HTTPClient http;
      http.setTimeout(4000);
      http.begin(SERVER_URL);
      http.addHeader("Content-Type", "application/json");
      http.addHeader("x-orcas-key", INGEST_KEY);
      int code = http.POST((uint8_t*)body, strlen(body));
      if (code == 200) {
        String resp = http.getString();           // {"ok":true,"setpointC":2}
        int i = resp.indexOf("setpointC\":");
        if (i >= 0) setpointC = resp.substring(i + 11).toFloat();
      }
      Serial.printf("POST %d  T=%.2f  RH=%.1f  setpoint=%.1f  compressor=%d\n", code, t, h, setpointC, compressorOn);
      http.end();
    }
  }
  delay(500);
}
