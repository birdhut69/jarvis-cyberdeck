#pragma once

// ──────────────────────────────────────────────────────────────
// Standalone Wireless JARVIS – Pin Configuration
// ESP32-S3 Super Mini + 1.8" ST7735 128×160
// ──────────────────────────────────────────────────────────────

// ST7735 SPI Display Pinout
#define TFT_CS    10
#define TFT_DC     9
#define TFT_RST    8
#define TFT_SCK   12
#define TFT_MOSI  11
#define TFT_MISO  -1
#define TFT_BL    13

// Navigation Buttons (2x push buttons)
#define BTN_LEFT   1   // Action trigger / Mic activate
#define BTN_RIGHT  2   // Mode toggle
#define BTN_DEBOUNCE_MS  200

// Display geometry
#define SCREEN_W      128
#define DRAW_W        128
#define SCREEN_H      160
#define TFT_ROTATION  0   // portrait
#define TFT_TAB       INITR_GREENTAB
#define TFT_COL_START 0
#define TFT_ROW_START 0
#define TFT_INVERT    false

// ── Wi-Fi & Gateway Settings ──────────────────────────────────
// Edit these with your actual credentials or configure them dynamically
#define WIFI_SSID       "Airtel_JADHAV"
#define WIFI_PASSWORD   "Wifi@8421348486"

// Vercel Serverless Gateway HTTP/WebSocket endpoint
// Example: "https://my-jarvis-gateway.vercel.app"
#define GATEWAY_HOST    "jarvis-cyberdeck-gateway.vercel.app"
#define GATEWAY_PORT    443

// Polling interval in ms for HTTP backup if WebSockets are offline
#define POLL_INTERVAL_MS 500

// ── Cyberpunk Color Palette (RGB565) ─────────────────────────
#define COL_BG        0x0000   // pure black
#define COL_PANEL     0x18C5   // dark blue-gray panels
#define COL_CYAN      0x07FF   // primary – cyan
#define COL_MAGENTA   0xF81F   // accent – magenta
#define COL_NEON      0x07E8   // accent – neon green
#define COL_WHITE     0xFFFF
#define COL_GRAY      0x7BEF   // mid gray
#define COL_DIM       0x4208   // dim gray
#define COL_BAR_BG    0x2104   // dark bar background
#define COL_GOOD      0x07E0   // green
#define COL_WARN      0xFD20   // orange
#define COL_CRIT      0xF800   // red
#define COL_BORDER    0x0333   // dim cyan border
