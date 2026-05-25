#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include "config.h"

// Subclass to fix ST7735 GREENTAB display offsets
class IcyTFT : public Adafruit_ST7735 {
public:
  using Adafruit_ST7735::Adafruit_ST7735;
  void fixOffset(int8_t c, int8_t r) { _colstart = c; _rowstart = r; }
};

IcyTFT tft(TFT_CS, TFT_DC, TFT_RST);
WiFiClientSecure client;

// ── Service & Characteristic UUIDs for Web Bluetooth ──────────
static const char* SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"; // Nordic UART Service
static const char* RX_CHAR_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"; // RX (Write)
static const char* TX_CHAR_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"; // TX (Notify)

NimBLECharacteristic* pTxCharacteristic = nullptr;
bool bleConnected = false;
String bleConsoleLog = "No BLE packets";

// ── State Variables ──────────────────────────────────────────
enum JarvisState {
  STATE_CONNECTING,
  STATE_IDLE,
  STATE_THINKING,
  STATE_SPEAKING
};

JarvisState currentJarvisState = STATE_IDLE;
String jarvisText = "JARVIS ONLINE";
uint8_t pageIdx = 2; // Start on Jarvis AI Reactor Page
const uint8_t NUM_PAGES = 4;
int angle = 0;
bool wifiConnected = false;
unsigned long lastPollMs = 0;
int audioWaveform[8] = {10, 25, 40, 15, 30, 20, 35, 10};
int rssiVal = -100;
String localIPStr = "0.0.0.0";
unsigned long lastRefreshMs = 0;
int scanLineY = 0;  // horizontal scan sweep position
int breathe = 0;    // breathing glow counter
bool breatheDir = true;

// Button State
uint8_t btnLeftPrev = HIGH;
uint8_t btnRightPrev = HIGH;
unsigned long btnLeftLast = 0;
unsigned long btnRightLast = 0;

// Forward Declarations
void parseJsonCommand(const char* jsonStr);
void setupBle();

// ── NimBLE Server Callbacks ───────────────────────────────────
class MyServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* pServer) override {
    bleConnected = true;
    bleConsoleLog = "Phone Connected!";
    Serial.println("[BLE] Client connected");
  }
  void onDisconnect(NimBLEServer* pServer) override {
    bleConnected = false;
    bleConsoleLog = "Phone Disconnected";
    Serial.println("[BLE] Client disconnected");
    NimBLEDevice::startAdvertising(); // restart advertising
  }
};

class RxCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pCharacteristic) override {
    std::string rxValue = pCharacteristic->getValue();
    if (rxValue.length() > 0) {
      Serial.printf("[BLE-RX] %s\n", rxValue.c_str());
      bleConsoleLog = String("RX: ") + rxValue.c_str();
      parseJsonCommand(rxValue.c_str());
    }
  }
};

// ── Drawing Utilities & Pages ─────────────────────────────────

void drawHeader(const char* title, uint16_t color) {
  tft.fillRect(0, 0, SCREEN_W, 14, COL_PANEL);
  tft.setTextSize(1);
  tft.setTextColor(color);
  int tw = strlen(title) * 6;
  tft.setCursor((SCREEN_W - tw) / 2, 3);
  tft.print(title);
  tft.drawFastHLine(0, 14, SCREEN_W, COL_BORDER);
}

void drawStatusBar() {
  tft.fillRect(0, 0, SCREEN_W, 12, COL_PANEL);
  tft.setTextSize(1);
  
  // 1. Wi-Fi Icon & Signal indicator
  uint16_t wifiCol = wifiConnected ? COL_NEON : COL_CRIT;
  tft.drawPixel(4, 8, wifiCol);
  tft.drawLine(2, 6, 6, 6, wifiCol);
  tft.drawLine(0, 4, 8, 4, wifiCol);
  tft.setTextColor(wifiCol, COL_PANEL);
  tft.setCursor(12, 2);
  tft.print(wifiConnected ? "ON" : "OFF");

  // 2. Centered Page Title
  const char* pageNames[] = {"DASHBOARD", "WI-FI STATE", "JARVIS CORE", "BLE DIALOG"};
  tft.setTextColor(COL_CYAN, COL_PANEL);
  int nw = strlen(pageNames[pageIdx]) * 6;
  tft.setCursor((SCREEN_W - nw) / 2, 2);
  tft.print(pageNames[pageIdx]);

  // 3. Bluetooth Icon Rune
  uint16_t bleCol = bleConnected ? COL_CYAN : COL_DIM;
  int bx = SCREEN_W - 12;
  int by = 2;
  tft.drawLine(bx, by, bx, by + 8, bleCol);
  tft.drawLine(bx, by, bx + 3, by + 2, bleCol);
  tft.drawLine(bx + 3, by + 2, bx, by + 4, bleCol);
  tft.drawLine(bx, by + 4, bx + 3, by + 6, bleCol);
  tft.drawLine(bx + 3, by + 6, bx, by + 8, bleCol);
  
  tft.drawFastHLine(0, 12, SCREEN_W, COL_BORDER);
}

void drawArcReactor(int cx, int cy, int radius, int rotationAngle, uint16_t color) {
  tft.fillCircle(cx, cy, radius + 4, COL_BG);

  // Outer glowing ring
  tft.drawCircle(cx, cy, radius, COL_DIM);
  tft.drawCircle(cx, cy, radius - 3, color);

  // Core energy circle
  tft.fillCircle(cx, cy, 6, COL_WHITE);
  tft.drawCircle(cx, cy, 8, color);

  // Draw rotating orbital dots using trig
  for (int i = 0; i < 4; i++) {
    float rad = radians(rotationAngle + (i * 90));
    int px = cx + cos(rad) * (radius - 7);
    int py = cy + sin(rad) * (radius - 7);
    tft.fillCircle(px, py, 3, color);
    tft.drawPixel(px, py, COL_WHITE);
  }
}

void printWrappedText(const String& text, int x, int y, int maxLines, uint16_t color) {
  tft.fillRect(x, y, SCREEN_W - (x * 2), maxLines * 10, COL_BG);
  tft.setTextSize(1);
  tft.setTextColor(color, COL_BG);
  int curX = x;
  int curY = y;
  int linesUsed = 1;

  for (size_t i = 0; i < text.length(); i++) {
    char c = text[i];
    if (curX + 6 > SCREEN_W - x || c == '\n') {
      curY += 10;
      curX = x;
      linesUsed++;
      if (linesUsed > maxLines) break;
      if (c == ' ' || c == '\n') continue;
    }
    tft.setCursor(curX, curY);
    tft.print(c);
    curX += 6;
  }
}

void drawPageDots() {
  int dotW = 5, gap = 4;
  int sx = (SCREEN_W - NUM_PAGES * (dotW + gap) + gap) / 2;
  for (uint8_t i = 0; i < NUM_PAGES; i++) {
    uint16_t col = (i == pageIdx) ? COL_CYAN : COL_DIM;
    tft.fillRect(sx + i * (dotW + gap), SCREEN_H - 8, dotW, 3, col);
  }
}

// ── Pages Rendering ──────────────────────────────────────────

void renderDashboard() {
  int y = 18;
  // Section title with decorative bracket
  tft.setTextColor(COL_CYAN, COL_BG);
  tft.setCursor(6, y); tft.print("[ SYSTEM OVERVIEW ]");
  tft.drawFastHLine(4, y + 10, SCREEN_W - 8, COL_BORDER);
  y += 16;

  // CPU bar
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("CPU");
  int cpuVal = 35 + (millis() / 300) % 25;
  tft.fillRect(28, y + 1, 68, 5, COL_BAR_BG);
  tft.fillRect(28, y + 1, map(cpuVal, 0, 100, 0, 68), 5, COL_NEON);
  tft.setTextColor(COL_WHITE, COL_BG);
  tft.setCursor(100, y); tft.print(String(cpuVal) + "%");
  y += 12;

  // RAM bar (live ESP heap)
  uint32_t heapFree = ESP.getFreeHeap() / 1024;
  uint32_t heapTotal = 320; // KB
  int ramPct = 100 - (heapFree * 100 / heapTotal);
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("RAM");
  tft.fillRect(28, y + 1, 68, 5, COL_BAR_BG);
  tft.fillRect(28, y + 1, map(ramPct, 0, 100, 0, 68), 5, COL_CYAN);
  tft.setTextColor(COL_WHITE, COL_BG);
  tft.setCursor(100, y); tft.print(String(ramPct) + "%");
  y += 12;

  // Signal bar
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("SIG");
  int sigPct = map(constrain(rssiVal, -100, -40), -100, -40, 0, 100);
  tft.fillRect(28, y + 1, 68, 5, COL_BAR_BG);
  uint16_t sigCol = sigPct > 50 ? COL_NEON : (sigPct > 25 ? COL_WARN : COL_CRIT);
  tft.fillRect(28, y + 1, map(sigPct, 0, 100, 0, 68), 5, sigCol);
  tft.setTextColor(COL_WHITE, COL_BG);
  tft.setCursor(100, y); tft.print(String(sigPct) + "%");
  y += 14;

  tft.drawFastHLine(4, y, SCREEN_W - 8, COL_BORDER);
  y += 6;

  // Network status block
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("NETWORK:");
  tft.setTextColor(wifiConnected ? COL_NEON : COL_CRIT, COL_BG);
  tft.setCursor(56, y); tft.print(wifiConnected ? "LINKED" : "DOWN");
  y += 11;

  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("IP:");
  tft.setTextColor(COL_WHITE, COL_BG);
  tft.setCursor(22, y); tft.print(localIPStr);
  y += 11;

  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("BLE:");
  tft.setTextColor(bleConnected ? COL_CYAN : COL_DIM, COL_BG);
  tft.setCursor(28, y); tft.print(bleConnected ? "PAIRED" : "ADVERT");
  y += 11;

  // Live uptime
  unsigned long secs = millis() / 1000;
  int m = secs / 60; int s = secs % 60;
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("UP:");
  tft.setTextColor(COL_CYAN, COL_BG);
  char uptimeBuf[12];
  snprintf(uptimeBuf, sizeof(uptimeBuf), "%02d:%02d", m, s);
  tft.setCursor(22, y); tft.print(uptimeBuf);
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(58, y); tft.print("HEAP:");
  tft.setTextColor(COL_NEON, COL_BG);
  tft.setCursor(88, y); tft.print(String(heapFree) + "K");
}

void renderWifiStats() {
  int y = 18;
  tft.setTextColor(COL_NEON, COL_BG);
  tft.setCursor(6, y); tft.print("[ WI-FI TELEMETRY ]");
  tft.drawFastHLine(4, y + 10, SCREEN_W - 8, COL_BORDER);
  y += 16;

  // SSID
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("SSID:");
  tft.setTextColor(COL_WHITE, COL_BG);
  tft.setCursor(36, y);
  tft.print(WiFi.SSID().length() > 0 ? WiFi.SSID() : "Airtel_JADHAV");
  y += 11;

  // Signal strength bar
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("RSSI:");
  tft.setTextColor(COL_NEON, COL_BG);
  tft.setCursor(36, y); tft.print(String(rssiVal) + "dBm");
  y += 10;
  int sigPct = map(constrain(rssiVal, -100, -40), -100, -40, 0, 112);
  tft.fillRect(4, y + 2, 120, 4, COL_BAR_BG);
  uint16_t barCol = sigPct > 60 ? COL_NEON : (sigPct > 30 ? COL_WARN : COL_CRIT);
  tft.fillRect(4, y + 2, sigPct, 4, barCol);
  y += 10;

  // IP Address
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("IP:");
  tft.setTextColor(COL_WHITE, COL_BG);
  tft.setCursor(22, y); tft.print(localIPStr);
  y += 11;

  // Gateway
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("GW:");
  tft.setTextColor(COL_DIM, COL_BG);
  tft.setCursor(22, y);
  if (WiFi.gatewayIP()) tft.print(WiFi.gatewayIP().toString());
  else tft.print("--");
  y += 11;

  // MAC Address
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("MAC:");
  tft.setTextColor(COL_DIM, COL_BG);
  tft.setCursor(28, y); tft.print(WiFi.macAddress().substring(0, 14));
  y += 11;

  // Channel
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("CH:");
  tft.setTextColor(COL_CYAN, COL_BG);
  tft.setCursor(22, y); tft.print(String(WiFi.channel()));

  // TX Power
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(46, y); tft.print("TX:");
  tft.setTextColor(COL_CYAN, COL_BG);
  tft.setCursor(64, y); tft.print("20dBm");
  y += 12;

  tft.drawFastHLine(4, y, SCREEN_W - 8, COL_BORDER);
  y += 5;

  // Connection uptime
  unsigned long secs = millis() / 1000;
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("UPTIME:");
  tft.setTextColor(COL_NEON, COL_BG);
  char buf[12];
  snprintf(buf, sizeof(buf), "%lum %lus", secs / 60, secs % 60);
  tft.setCursor(48, y); tft.print(buf);
}

// ── Arc Reactor Core Engine ───────────────────────────────────

void renderJarvisCore() {
  // Clear the reactor canvas
  tft.fillRect(0, 13, SCREEN_W, SCREEN_H - 25, COL_BG);

  int cx = SCREEN_W / 2;
  int cy = 56;

  // ── State-dependent color theme ──
  uint16_t mainCol = COL_CYAN;
  uint16_t accentCol = COL_NEON;
  const char* stateLabel = "STANDBY";
  int rotSpeed = 3;
  if (currentJarvisState == STATE_THINKING) {
    mainCol = COL_WARN; accentCol = COL_WHITE; stateLabel = "ANALYZING";
    rotSpeed = 8;
  } else if (currentJarvisState == STATE_SPEAKING) {
    mainCol = COL_MAGENTA; accentCol = COL_CYAN; stateLabel = "SPEAKING";
    rotSpeed = 5;
  } else if (currentJarvisState == STATE_CONNECTING) {
    mainCol = COL_CRIT; accentCol = COL_WARN; stateLabel = "CONNECTING";
    rotSpeed = 6;
  }

  // ── Breathing pulse for core radius ──
  if (breatheDir) { breathe++; if (breathe >= 10) breatheDir = false; }
  else { breathe--; if (breathe <= 0) breatheDir = true; }

  // ── HUD Corner Brackets ──
  int bk = 8;
  tft.drawFastHLine(4, 16, bk, mainCol);
  tft.drawFastVLine(4, 16, bk, mainCol);
  tft.drawFastHLine(SCREEN_W - 4 - bk, 16, bk, mainCol);
  tft.drawFastVLine(SCREEN_W - 5, 16, bk, mainCol);
  tft.drawFastHLine(4, 96, bk, mainCol);
  tft.drawFastVLine(4, 96 - bk, bk, mainCol);
  tft.drawFastHLine(SCREEN_W - 4 - bk, 96, bk, mainCol);
  tft.drawFastVLine(SCREEN_W - 5, 96 - bk, bk, mainCol);

  // ── Outer ring (dim structural ring) ──
  tft.drawCircle(cx, cy, 34, COL_DIM);

  // ── Middle ring (main color, pulsing) ──
  int midR = 28 + breathe / 5;
  tft.drawCircle(cx, cy, midR, mainCol);

  // ── Inner ring ──
  tft.drawCircle(cx, cy, 18, COL_BORDER);

  // ── Rotating triangular reactor segments (3 segments at 120° apart) ──
  for (int seg = 0; seg < 3; seg++) {
    float segAngle = radians(angle + seg * 120);
    float segAngle2 = radians(angle + seg * 120 + 30);
    
    int x1 = cx + cos(segAngle) * 20;
    int y1 = cy + sin(segAngle) * 20;
    int x2 = cx + cos(segAngle2) * 20;
    int y2 = cy + sin(segAngle2) * 20;
    int x3 = cx + cos(radians(angle + seg * 120 + 15)) * 32;
    int y3 = cy + sin(radians(angle + seg * 120 + 15)) * 32;
    
    tft.drawLine(x1, y1, x3, y3, mainCol);
    tft.drawLine(x2, y2, x3, y3, mainCol);
    tft.drawLine(x1, y1, x2, y2, COL_DIM);
  }

  // ── 6 Rotating orbital energy dots on outer ring ──
  for (int d = 0; d < 6; d++) {
    float dotAngle = radians(angle * 2 + d * 60);
    int dx = cx + cos(dotAngle) * 34;
    int dy = cy + sin(dotAngle) * 34;
    tft.fillCircle(dx, dy, 2, accentCol);
    tft.drawPixel(dx, dy, COL_WHITE);
  }

  // ── Core center ──
  int coreR = 6 + breathe / 4;
  tft.fillCircle(cx, cy, coreR, mainCol);
  tft.fillCircle(cx, cy, coreR - 2, COL_WHITE);
  tft.drawCircle(cx, cy, coreR + 1, accentCol);

  // ── Speaking mode: equalizer bars around the reactor ──
  if (currentJarvisState == STATE_SPEAKING) {
    for (int i = 0; i < 8; i++) {
      float barAngle = radians(i * 45 + angle);
      int bh = audioWaveform[i] % 12;
      if (bh < 3) bh = 3;
      int bx1 = cx + cos(barAngle) * 36;
      int by1 = cy + sin(barAngle) * 36;
      int bx2 = cx + cos(barAngle) * (36 + bh);
      int by2 = cy + sin(barAngle) * (36 + bh);
      tft.drawLine(bx1, by1, bx2, by2, COL_MAGENTA);
      tft.fillCircle(bx2, by2, 1, COL_WHITE);
    }
  }

  // ── Thinking mode: scanning orbit particle ──
  if (currentJarvisState == STATE_THINKING) {
    float scanAngle = radians((millis() / 3) % 360);
    int sx = cx + cos(scanAngle) * 26;
    int sy = cy + sin(scanAngle) * 26;
    tft.fillCircle(sx, sy, 3, COL_WARN);
    tft.drawCircle(sx, sy, 5, COL_DIM);
  }

  // ── Bottom HUD Data Strip ──
  int hudY = 98;
  tft.drawFastHLine(4, hudY, SCREEN_W - 8, COL_BORDER);
  hudY += 3;
  tft.setTextSize(1);

  // State label (left)
  tft.setTextColor(mainCol, COL_BG);
  tft.setCursor(4, hudY);
  tft.print(stateLabel);

  // Uptime (right)
  unsigned long secs = millis() / 1000;
  char upBuf[8];
  snprintf(upBuf, sizeof(upBuf), "%02lu:%02lu", secs / 60, secs % 60);
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(SCREEN_W - 34, hudY);
  tft.print(upBuf);
  hudY += 11;

  // Response text area
  printWrappedText(jarvisText, 4, hudY, 4, COL_WHITE);
}

void renderBleConsole() {
  int y = 18;
  tft.setTextColor(COL_CYAN, COL_BG);
  tft.setCursor(6, y); tft.print("[ BLE TERMINAL ]");
  tft.drawFastHLine(4, y + 10, SCREEN_W - 8, COL_BORDER);
  y += 16;

  // Device name
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("NAME:");
  tft.setTextColor(COL_WHITE, COL_BG);
  tft.setCursor(36, y); tft.print("ICYWALL JARVIS");
  y += 11;

  // Status
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("LINK:");
  tft.setTextColor(bleConnected ? COL_NEON : COL_WARN, COL_BG);
  tft.setCursor(36, y); tft.print(bleConnected ? "ACTIVE" : "SCANNING");
  y += 11;

  // Service UUID (shortened)
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("SVC:");
  tft.setTextColor(COL_DIM, COL_BG);
  tft.setCursor(28, y); tft.print("6E40..DCCA9E");
  y += 11;

  // MTU / Protocol
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("MTU:");
  tft.setTextColor(COL_CYAN, COL_BG);
  tft.setCursor(28, y); tft.print("256");
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(56, y); tft.print("PROTO:");
  tft.setTextColor(COL_CYAN, COL_BG);
  tft.setCursor(92, y); tft.print("NimBLE");
  y += 12;

  tft.drawFastHLine(4, y, SCREEN_W - 8, COL_BORDER);
  y += 5;

  // Packet log area
  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(4, y); tft.print("LAST RX PACKET:");
  y += 10;
  // Draw a mini terminal frame
  tft.drawRect(3, y, SCREEN_W - 6, 40, COL_DIM);
  printWrappedText(bleConsoleLog, 6, y + 3, 3, COL_CYAN);
}

void renderPage() {
  drawStatusBar();
  switch (pageIdx) {
    case 0: renderDashboard(); break;
    case 1: renderWifiStats(); break;
    case 2: renderJarvisCore(); break;
    case 3: renderBleConsole(); break;
  }
  // Bottom border line
  tft.drawFastHLine(0, SCREEN_H - 12, SCREEN_W, COL_BORDER);
  drawPageDots();
  tft.drawRect(0, 12, SCREEN_W, SCREEN_H - 12, COL_BORDER);
}

// ── Networking & API Polling ──────────────────────────────────

void pollGatewayStatus() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String("https://") + GATEWAY_HOST + "/api/status";
  
  // Serialize active Wi-Fi stats to upload to Web App
  StaticJsonDocument<256> doc;
  doc["ip"] = localIPStr;
  doc["rssi"] = rssiVal;
  doc["page"] = pageIdx;
  String jsonStr;
  serializeJson(doc, jsonStr);

  client.setInsecure();
  if (http.begin(client, url)) {
    http.addHeader("Content-Type", "application/json");
    int httpCode = http.POST(jsonStr);
    if (httpCode == HTTP_CODE_OK || httpCode == 201) {
      String payload = http.getString();
      parseJsonCommand(payload.c_str());
    }
    http.end();
  }
}

void triggerVoiceActivation() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String("https://") + GATEWAY_HOST + "/api/trigger";
  
  client.setInsecure();
  if (http.begin(client, url)) {
    http.POST("");
    http.end();
  }
}

// ── JSON Command Parser ────────────────────────────────────────

void parseJsonCommand(const char* jsonStr) {
  StaticJsonDocument<1024> doc;
  DeserializationError error = deserializeJson(doc, jsonStr);
  
  if (error) return;

  // 1. Check for State updates
  if (doc.containsKey("status")) {
    const char* status = doc["status"] | "idle";
    if (strcmp(status, "idle") == 0) {
      currentJarvisState = STATE_IDLE;
    } else if (strcmp(status, "thinking") == 0) {
      currentJarvisState = STATE_THINKING;
    } else if (strcmp(status, "speaking") == 0) {
      currentJarvisState = STATE_SPEAKING;
    }
  }

  // 2. Check for Text updates
  if (doc.containsKey("text")) {
    const char* text = doc["text"] | "";
    jarvisText = String(text);
  }

  // 3. Check for Waveform
  JsonArray arr = doc["waveform"];
  if (arr) {
    for (int i = 0; i < 8; i++) {
      audioWaveform[i] = arr[i] | 10;
    }
  }

  // 3.5 Check for Page state sync
  if (doc.containsKey("page")) {
    int p = doc["page"];
    if (p != pageIdx) {
      pageIdx = constrain(p, 0, NUM_PAGES - 1);
      tft.fillScreen(COL_BG);
    }
  }

  // 4. Check for direct UI page changes
  if (doc.containsKey("cmd")) {
    const char* cmd = doc["cmd"] | "";
    if (strcmp(cmd, "page") == 0 && doc.containsKey("v")) {
      pageIdx = constrain((int)doc["v"], 0, NUM_PAGES - 1);
      tft.fillScreen(COL_BG); // clear screen for quick switch
    }
    else if (strcmp(cmd, "bl") == 0 && doc.containsKey("v")) {
      int brightness = doc["v"] | 255;
      analogWrite(TFT_BL, constrain(brightness, 0, 255));
    }
    // Remote Wi-Fi credentials set!
    else if (strcmp(cmd, "wifi") == 0 && doc.containsKey("ssid") && doc.containsKey("pass")) {
      const char* newSsid = doc["ssid"];
      const char* newPass = doc["pass"];
      tft.fillScreen(COL_BG);
      drawHeader("SAVING WI-FI", COL_WARN);
      printWrappedText(String("Connecting to:\n") + newSsid, 8, 40, 4, COL_WARN);
      
      WiFi.disconnect();
      WiFi.begin(newSsid, newPass);
      // Try connecting for 10s
      int attempts = 0;
      while (WiFi.status() != WL_CONNECTED && attempts < 20) {
        delay(500);
        attempts++;
      }
      tft.fillScreen(COL_BG);
    }
  }
}

// ── BLE Setup ─────────────────────────────────────────────────

void setupBle() {
  NimBLEDevice::init("ICYWALL JARVIS");
  NimBLEServer* pServer = NimBLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  NimBLEService* pService = pServer->createService(SERVICE_UUID);
  pTxCharacteristic = pService->createCharacteristic(
                        TX_CHAR_UUID,
                        NIMBLE_PROPERTY::NOTIFY
                      );

  NimBLECharacteristic* pRxCharacteristic = pService->createCharacteristic(
                        RX_CHAR_UUID,
                        NIMBLE_PROPERTY::WRITE
                      );
  pRxCharacteristic->setCallbacks(new RxCallbacks());

  pService->start();

  NimBLEAdvertising* pAdvertising = NimBLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->start();
  Serial.println("[BLE] Advertising started. Ready for phone browser!");
}

// ── Main Core Loop ────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(300);
  client.setInsecure();

  // Initialize backlight
  pinMode(TFT_BL, OUTPUT);
  analogWrite(TFT_BL, 255);

  // Initialize TFT Screen
  if (TFT_RST >= 0) {
    pinMode(TFT_RST, OUTPUT);
    digitalWrite(TFT_RST, HIGH); delay(50);
    digitalWrite(TFT_RST, LOW); delay(50);
    digitalWrite(TFT_RST, HIGH); delay(150);
  }
  
  SPI.begin(TFT_SCK, TFT_MISO, TFT_MOSI, -1);
  tft.initR(TFT_TAB);
  tft.invertDisplay(TFT_INVERT);
  tft.setRotation(TFT_ROTATION);
  tft.fillScreen(COL_BG);
  tft.setTextWrap(false);

  // Welcome Loader
  drawHeader("JARVIS MK-III", COL_CYAN);
  tft.setTextSize(1);
  tft.setTextColor(COL_CYAN, COL_BG);
  tft.setCursor(14, 50);
  tft.print("BOOTING WI-FI + BLE");
  tft.setCursor(14, 70);
  tft.print("SSID: Airtel_JADHAV");

  // Button Pins
  pinMode(BTN_LEFT, INPUT_PULLUP);
  pinMode(BTN_RIGHT, INPUT_PULLUP);

  // BLE Activation
  setupBle();

  // Wi-Fi Connection Attempts
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 16) {
    delay(500);
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    localIPStr = WiFi.localIP().toString();
    rssiVal = WiFi.RSSI();
    tft.fillScreen(COL_BG);
    drawHeader("SYSTEM UP", COL_NEON);
    printWrappedText("Core Ready!\nWi-Fi Connected.\nLocal IP:\n" + localIPStr, 8, 40, 5, COL_NEON);
    delay(1500);
  } else {
    wifiConnected = false;
    tft.fillScreen(COL_BG);
    drawHeader("OFFLINE TERM", COL_WARN);
    printWrappedText("Wi-Fi timeout.\nPair phone over BLE\nto control local terminal.", 8, 40, 5, COL_WARN);
    delay(2500);
  }
  
  tft.fillScreen(COL_BG);
  lastRefreshMs = millis();
}

void loop() {
  unsigned long now = millis();
  angle = (angle + 4) % 360;

  // 1. Read Wi-Fi strength periodically
  if (wifiConnected && (now % 8000 == 0)) {
    rssiVal = WiFi.RSSI();
  }

  // 2. Poll the Vercel gateway status
  if (wifiConnected && (now - lastPollMs >= POLL_INTERVAL_MS)) {
    pollGatewayStatus();
    lastPollMs = now;
  }

  // 3. Poll Left Button (Mic Trigger / Voice Activation)
  uint8_t btnL = digitalRead(BTN_LEFT);
  if (btnL == LOW && btnLeftPrev == HIGH && (now - btnLeftLast > BTN_DEBOUNCE_MS)) {
    btnLeftLast = now;
    tft.fillScreen(COL_BG);
    drawHeader("LISTENING...", COL_CYAN);
    tft.fillCircle(SCREEN_W / 2, 70, 24, COL_CYAN);
    tft.fillCircle(SCREEN_W / 2, 70, 20, COL_BG);
    tft.setTextSize(1);
    tft.setTextColor(COL_CYAN, COL_BG);
    tft.setCursor(20, 110);
    tft.print("Speak to Phone Mic");
    
    // Notify over BLE or Wi-Fi depending on link
    if (bleConnected && pTxCharacteristic) {
      pTxCharacteristic->setValue("{\"trigger\":\"mic\"}");
      pTxCharacteristic->notify();
    } else {
      triggerVoiceActivation();
    }
    
    delay(1000);
    tft.fillScreen(COL_BG);
  }
  btnLeftPrev = btnL;

  // 4. Poll Right Button (Physical Page/Menu Cycle)
  uint8_t btnR = digitalRead(BTN_RIGHT);
  if (btnR == LOW && btnRightPrev == HIGH && (now - btnRightLast > BTN_DEBOUNCE_MS)) {
    btnRightLast = now;
    pageIdx = (pageIdx + 1) % NUM_PAGES;
    tft.fillScreen(COL_BG);
    renderPage();
  }
  btnRightPrev = btnR;

  // 5. Draw active pages
  if (now - lastRefreshMs >= 33) { // 30 FPS redraw limit
    renderPage();
    lastRefreshMs = now;
  }

  delay(10);
}
