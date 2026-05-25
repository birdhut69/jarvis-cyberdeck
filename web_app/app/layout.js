export const metadata = {
  title: 'JARVIS Cyberdeck Gateway',
  description: 'Autonomous Wireless Gateway for ESP32 Super Mini HUD Terminal',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Share+Tech+Mono&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: '#000', color: '#fff', fontFamily: "'Outfit', sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
