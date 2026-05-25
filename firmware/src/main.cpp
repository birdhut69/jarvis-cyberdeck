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
  tft.setTextColor(COL_CYAN, COL_BG);
  tft.setCursor(6, y); tft.print("SYSTEM STATUS");
  tft.drawFastHLine(6, y + 10, SCREEN_W - 12, COL_DIM);
  y += 16;

  // Local simulated computer metrics or Wi-Fi info
  tft.setTextColor(COL_WHITE, COL_BG);
  tft.setCursor(8, y); tft.print("CPU:");
  tft.fillRect(36, y + 1, 55, 6, COL_BAR_BG);
  tft.fillRect(36, y + 1, 24, 6, COL_NEON);
  tft.setCursor(96, y); tft.print("42%");
  y += 14;

  tft.setCursor(8, y); tft.print("RAM:");
  tft.fillRect(36, y + 1, 55, 6, COL_BAR_BG);
  tft.fillRect(36, y + 1, 38, 6, COL_CYAN);
  tft.setCursor(96, y); tft.print("68%");
  y += 14;

  tft.setCursor(8, y); tft.print("NET:");
  tft.setTextColor(wifiConnected ? COL_NEON : COL_CRIT, COL_BG);
  tft.setCursor(36, y); tft.print(wifiConnected ? "CONNECTED" : "OFFLINE");
  y += 16;

  tft.drawFastHLine(6, y, SCREEN_W - 12, COL_DIM);
  y += 6;

  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(8, y); tft.print("LOCAL GATEWAY IP:");
  y += 10;
  tft.setTextColor(COL_WHITE, COL_BG);
  tft.setCursor(8, y); tft.print(localIPStr);
  y += 14;

  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(8, y); tft.print("BLE HOST LINK:");
  y += 10;
  tft.setTextColor(bleConnected ? COL_CYAN : COL_DIM, COL_BG);
  tft.setCursor(8, y); tft.print(bleConnected ? "PHONE ACTIVE" : "BROADCASTING");
}

void renderWifiStats() {
  int y = 18;
  tft.setTextColor(COL_NEON, COL_BG);
  tft.setCursor(6, y); tft.print("WI-FI TELEMETRY");
  tft.drawFastHLine(6, y + 10, SCREEN_W - 12, COL_DIM);
  y += 16;

  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(8, y); tft.print("SSID:");
  tft.setTextColor(COL_WHITE, COL_BG);
  tft.setCursor(44, y); tft.print(WiFi.SSID().length() > 0 ? WiFi.SSID() : "Airtel_JADHAV");
  y += 14;

  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(8, y); tft.print("SIGNAL:");
  tft.setTextColor(COL_NEON, COL_BG);
  tft.setCursor(54, y); tft.print(String(rssiVal) + " dBm");
  y += 10;
  tft.fillRect(8, y + 4, 112, 6, COL_BAR_BG);
  int signalPercent = map(constrain(rssiVal, -100, -40), -100, -40, 5, 112);
  tft.fillRect(8, y + 4, signalPercent, 6, COL_NEON);
  y += 18;

  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(8, y); tft.print("IP ADDRESS:");
  tft.setTextColor(COL_WHITE, COL_BG);
  tft.setCursor(8, y + 10); tft.print(localIPStr);
  y += 24;

  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(8, y); tft.print("PING SPEED:");
  tft.setTextColor(COL_CYAN, COL_BG);
  tft.setCursor(76, y); tft.print("14 ms");
}

void renderJarvisCore() {
  // Clear the AI Core graphics face area to draw the next frame
  tft.fillRect(4, 18, SCREEN_W - 8, 82, COL_BG);

  int cx = SCREEN_W / 2;
  int cy = 58;

  // Let's implement active blinking eyes
  bool blink = (millis() % 4000 < 150); // blinks for 150ms every 4 seconds

  if (currentJarvisState == STATE_IDLE) {
    // ── IDLE STATE: Smiling Cybernetic AI Face ──
    uint16_t eyeCol = COL_CYAN;
    
    // Eyes: Draw circular eyes or lines if blinking
    if (blink) {
      tft.drawFastHLine(cx - 24, cy, 12, eyeCol);
      tft.drawFastHLine(cx + 12, cy, 12, eyeCol);
    } else {
      tft.fillCircle(cx - 18, cy, 7, eyeCol);
      tft.fillCircle(cx - 18, cy, 2, COL_WHITE); // highlight
      tft.fillCircle(cx + 18, cy, 7, eyeCol);
      tft.fillCircle(cx + 18, cy, 2, COL_WHITE); // highlight
    }
    
    // Mouth: Calm line
    tft.drawFastHLine(cx - 15, cy + 18, 30, COL_NEON);
  }
  else if (currentJarvisState == STATE_THINKING) {
    // ── THINKING STATE: Alert Eyes Shifting + Swirling Arc ──
    uint16_t eyeCol = COL_WARN;
    int shift = sin(millis() / 150.0) * 4;
    
    tft.fillCircle(cx - 18 + shift, cy, 5, eyeCol);
    tft.fillCircle(cx + 18 + shift, cy, 5, eyeCol);
    
    // Swirling thinking arc around mouth
    int mouthAngle = (millis() / 2) % 360;
    float rad = radians(mouthAngle);
    int mx = cx + cos(rad) * 12;
    int my = cy + 18 + sin(rad) * 4;
    tft.fillCircle(mx, my, 2, COL_WARN);
    tft.drawCircle(cx, cy + 18, 8, COL_DIM);
  }
  else if (currentJarvisState == STATE_SPEAKING) {
    // ── SPEAKING STATE: Glowing Pulsing Core + Synchronized Vocal Mouth ──
    uint16_t eyeCol = COL_MAGENTA;
    int eyePulse = sin(millis() / 80.0) * 2 + 7;
    
    tft.fillCircle(cx - 18, cy, eyePulse, eyeCol);
    tft.fillCircle(cx + 18, cy, eyePulse, eyeCol);

    // Mouth Lip sync height mapped directly to incoming real-time audio waveform!
    int h = audioWaveform[4] % 16;
    if (h < 2) h = 2;
    tft.fillRect(cx - 15, cy + 18 - h/2, 30, h, COL_NEON);
    tft.drawRect(cx - 15, cy + 18 - h/2, 30, h, COL_CYAN);
  }
  else {
    // ── LISTENING STATE: Large Glowing Cyan Eyes ──
    uint16_t eyeCol = COL_MAGENTA;
    int size = sin(millis() / 120.0) * 2 + 9;
    
    tft.fillCircle(cx - 18, cy, size, eyeCol);
    tft.fillCircle(cx + 18, cy, size, eyeCol);
    
    // Smiling curved mouth
    tft.drawPixel(cx - 16, cy + 16, COL_CYAN);
    tft.drawPixel(cx + 16, cy + 16, COL_CYAN);
    tft.drawFastHLine(cx - 15, cy + 18, 30, COL_CYAN);
    tft.drawPixel(cx - 10, cy + 19, COL_CYAN);
    tft.drawPixel(cx + 10, cy + 19, COL_CYAN);
    tft.drawFastHLine(cx - 9, cy + 20, 18, COL_CYAN);
  }

  // Draw scrolling subtitle text block at the bottom
  tft.drawFastHLine(6, 102, SCREEN_W - 12, COL_DIM);
  printWrappedText(jarvisText, 6, 110, 4, COL_WHITE);
}

void renderBleConsole() {
  int y = 18;
  tft.setTextColor(COL_CYAN, COL_BG);
  tft.setCursor(6, y); tft.print("WEB BLE REMOTE");
  tft.drawFastHLine(6, y + 10, SCREEN_W - 12, COL_DIM);
  y += 16;

  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(8, y); tft.print("DEVICE NAME:");
  tft.setTextColor(COL_WHITE, COL_BG);
  tft.setCursor(8, y + 10); tft.print("ICYWALL JARVIS");
  y += 24;

  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(8, y); tft.print("BLE STATUS:");
  tft.setTextColor(bleConnected ? COL_NEON : COL_WARN, COL_BG);
  tft.setCursor(8, y + 10); tft.print(bleConnected ? "CONNECTED LOCAL" : "ADVERTISING...");
  y += 24;

  tft.drawFastHLine(6, y, SCREEN_W - 12, COL_DIM);
  y += 6;

  tft.setTextColor(COL_GRAY, COL_BG);
  tft.setCursor(8, y); tft.print("LAST INCOMING PACKET:");
  y += 12;
  printWrappedText(bleConsoleLog, 8, y, 4, COL_CYAN);
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
  drawHeader("JARVIS CORE v2.0", COL_CYAN);
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
