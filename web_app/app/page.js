'use client';

import React, { useState, useEffect, useRef } from 'react';

export default function JarvisDashboard() {
  const [status, setStatus] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [jarvisResponse, setJarvisResponse] = useState('JARVIS ONLINE. Network link established.');
  const [isListening, setIsListening] = useState(false);
  const [textModeInput, setTextModeInput] = useState('');

  // Wi-Fi & Terminal Sync Status
  const [espIP, setEspIP] = useState('0.0.0.0');
  const [espRSSI, setEspRSSI] = useState('Offline');
  const [espState, setEspState] = useState('Idle');
  const [currentPage, setCurrentPage] = useState(2); // 2 is Jarvis AI Page

  // Web Bluetooth (BLE) State
  const [bleDevice, setBleDevice] = useState(null);
  const [bleConnected, setBleConnected] = useState(false);
  const [bleConsoleLogs, setBleConsoleLogs] = useState([]);
  const [txCharacteristic, setTxCharacteristic] = useState(null);
  const [rxCharacteristic, setRxCharacteristic] = useState(null);

  const recognitionRef = useRef(null);
  const synthRef = useRef(null);

  const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // RX on ESP32 (Write)
  const TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // TX on ESP32 (Notify)

  // ── Initialize Speech & Telemetry Polling ────────────────────
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const rec = new SpeechRecognition();
        rec.continuous = false;
        rec.interimResults = false;
        rec.lang = 'en-US';

        rec.onstart = () => {
          setIsListening(true);
          updateServerStatus('thinking', 'JARVIS LISTENING...');
        };

        rec.onresult = async (event) => {
          const text = event.results[0][0].transcript;
          setTranscript(text);
          await handleSendToGemini(text);
        };

        rec.onerror = (err) => {
          console.error(err);
          setIsListening(false);
          updateServerStatus('idle', 'SPEECH INPUT ERROR');
        };

        rec.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current = rec;
      }
      synthRef.current = window.speechSynthesis;
    }

    // High frequency Cloud-Sync polling for Wi-Fi Telemetry & triggers
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        
        // Sync Wi-Fi status indicators
        setEspState(data.status);
        if (data.ip) setEspIP(data.ip);
        if (data.rssi) setEspRSSI(data.rssi + " dBm");
        
        // Auto-trigger voice if ESP32 physical button pressed
        if (data.status === 'trigger_listening') {
          startListening();
        }
      } catch (err) {
        // Silent catch for dev server disconnects
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // ── Web Bluetooth BLE Integration ──────────────────────────
  
  const addBleLog = (msg) => {
    setBleConsoleLogs(prev => [msg, ...prev.slice(0, 10)]);
  };

  const connectLocalBLE = async () => {
    if (!navigator.bluetooth) {
      alert("Web Bluetooth is not supported on this browser/device. Try Chrome, Edge, or Blueify on iOS.");
      return;
    }

    try {
      addBleLog("Requesting Bluetooth device...");
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: 'ICYWALL JARVIS' }],
        optionalServices: [SERVICE_UUID]
      });

      setBleDevice(device);
      addBleLog(`Connecting to ${device.name}...`);
      
      const server = await device.gatt.connect();
      addBleLog("GATT Server connected.");
      
      const service = await server.getPrimaryService(SERVICE_UUID);
      addBleLog("Primary Service located.");

      // RX characteristic (Write commands to ESP32)
      const rxChar = await service.getCharacteristic(RX_UUID);
      setRxCharacteristic(rxChar);
      
      // TX characteristic (Listen to notifications from ESP32)
      const txChar = await service.getCharacteristic(TX_UUID);
      setTxCharacteristic(txChar);
      
      await txChar.startNotifications();
      txChar.addEventListener('characteristicvaluechanged', handleBleNotification);
      
      setBleConnected(true);
      addBleLog("Web BLE Linked successfully!");
      
      device.addEventListener('gattserverdisconnected', () => {
        setBleConnected(false);
        addBleLog("BLE Disconnected");
      });

    } catch (error) {
      console.error(error);
      addBleLog(`BLE Error: ${error.message}`);
    }
  };

  const handleBleNotification = (event) => {
    const value = new TextDecoder().decode(event.target.value);
    addBleLog(`Notification received: ${value}`);
    try {
      const data = JSON.parse(value);
      if (data.trigger === 'mic') {
        startListening();
      }
    } catch (e) {
      // Notification wasn't JSON
    }
  };

  const sendBleCommand = async (commandObj) => {
    if (!bleConnected || !rxCharacteristic) return;
    try {
      const jsonStr = JSON.stringify(commandObj);
      const encoder = new TextEncoder();
      await rxCharacteristic.writeValue(encoder.encode(jsonStr));
      addBleLog(`Sent BLE Command: ${jsonStr}`);
    } catch (err) {
      addBleLog(`Write Error: ${err.message}`);
    }
  };

  // ── Sync Helper Functions ───────────────────────────────────

  const updateServerStatus = async (statusStr, textStr) => {
    setStatus(statusStr);
    
    // Cloud sync
    try {
      await fetch('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusStr, text: textStr })
      });
    } catch (e) {}

    // BLE Sync
    if (bleConnected) {
      sendBleCommand({ status: statusStr, text: textStr });
    }
  };

  // Remote menu browser page switcher
  const handlePageSwitch = async (pageNumber) => {
    setCurrentPage(pageNumber);
    
    // 1. Send via Cloud HTTP status endpoint
    try {
      await fetch('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: 'page', v: pageNumber })
      });
    } catch (e) {}

    // 2. Send instantly over Bluetooth if linked
    if (bleConnected) {
      sendBleCommand({ cmd: 'page', v: pageNumber });
    }
  };

  const startListening = () => {
    if (synthRef.current && synthRef.current.speaking) {
      synthRef.current.cancel();
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch (e) {
        recognitionRef.current.stop();
      }
    }
  };

  const handleSendToGemini = async (promptText) => {
    updateServerStatus('thinking', 'JARVIS CORE PROCESSING...');
    setJarvisResponse('Querying neural matrix...');
    
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText })
      });
      const data = await res.json();

      if (data.response) {
        setJarvisResponse(data.response);
        speakResponse(data.response);
      } else {
        throw new Error(data.error || 'AI Node Offline');
      }
    } catch (err) {
      setJarvisResponse(`ERROR: ${err.message}`);
      updateServerStatus('idle', 'CORE OFFLINE');
    }
  };

  const speakResponse = (textToSpeak) => {
    if (!synthRef.current) return;

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    const voices = synthRef.current.getVoices();
    const britishVoice = voices.find(voice => voice.lang.includes('en-GB'));
    if (britishVoice) utterance.voice = britishVoice;
    
    utterance.rate = 1.05;
    utterance.pitch = 0.95;

    // Simulate audio frequencies for the ESP32 spectrogram while speaking
    const interval = setInterval(() => {
      if (synthRef.current.speaking) {
        const dummyWave = Array.from({ length: 8 }, () => Math.floor(Math.random() * 32) + 8);
        if (bleConnected) {
          sendBleCommand({ waveform: dummyWave });
        } else {
          fetch('/api/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'speaking', text: textToSpeak, waveform: dummyWave })
          }).catch(() => {});
        }
      } else {
        clearInterval(interval);
      }
    }, 150);

    utterance.onstart = () => {
      updateServerStatus('speaking', textToSpeak);
    };

    utterance.onend = () => {
      updateServerStatus('idle', 'JARVIS STANDBY');
    };

    synthRef.current.speak(utterance);
  };

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (!textModeInput.trim()) return;
    setTranscript(textModeInput);
    handleSendToGemini(textModeInput);
    setTextModeInput('');
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(circle at center, #0a1128 0%, #000411 100%)',
      padding: '30px 15px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Dynamic Cyber Glow Elements */}
      <div style={{ position: 'absolute', width: '600px', height: '600px', background: 'radial-gradient(circle, rgba(0, 245, 255, 0.06) 0%, transparent 70%)', top: '-10%', left: '-10%', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', width: '600px', height: '600px', background: 'radial-gradient(circle, rgba(248, 31, 255, 0.05) 0%, transparent 70%)', bottom: '-10%', right: '-10%', pointerEvents: 'none' }} />

      {/* Main Glassmorphic Panel */}
      <div style={{
        width: '100%',
        maxWidth: '850px',
        background: 'rgba(10, 20, 38, 0.5)',
        backdropFilter: 'blur(25px)',
        border: '1px solid rgba(0, 245, 255, 0.25)',
        borderRadius: '28px',
        padding: '30px',
        boxShadow: '0 0 50px rgba(0, 245, 255, 0.12)',
        zIndex: 10,
        boxSizing: 'border-box'
      }}>
        
        {/* Terminal Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '15px',
          borderBottom: '1px solid rgba(0, 245, 255, 0.2)',
          paddingBottom: '15px',
          marginBottom: '25px'
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '26px', fontWeight: '800', letterSpacing: '3px', color: '#00f5ff', textShadow: '0 0 12px rgba(0, 245, 255, 0.5)' }}>
              JARVIS CYBERDECK
            </h1>
            <span style={{ fontSize: '11px', fontFamily: "'Share Tech Mono', monospace", color: 'rgba(255, 255, 255, 0.45)' }}>
              SYSTEM TELEMETRY GATEWAY v2.0 // WIRELESS DUAL-LINK ACTIVE
            </span>
          </div>

          {/* Local Web Bluetooth Connection Trigger */}
          <button 
            onClick={connectLocalBLE}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: bleConnected ? 'rgba(7, 232, 100, 0.1)' : 'rgba(0, 245, 255, 0.05)',
              border: bleConnected ? '1px solid #07E8' : '1px solid rgba(0, 245, 255, 0.3)',
              borderRadius: '50px',
              padding: '8px 20px',
              fontSize: '12px',
              fontFamily: "'Share Tech Mono', monospace",
              color: bleConnected ? '#07E8' : '#00f5ff',
              cursor: 'pointer',
              fontWeight: '600',
              transition: 'all 0.3s ease'
            }}
          >
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: bleConnected ? '#07E8' : '#00f5ff',
              boxShadow: bleConnected ? '0 0 8px #07E8' : '0 0 8px #00f5ff',
              animation: 'pulse 1.5s infinite'
            }} />
            {bleConnected ? 'LOCAL BLE CONNECTED' : 'CONNECT LOCAL BLE'}
          </button>
        </div>

        {/* Dynamic Telemetry Status Hub */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '15px',
          marginBottom: '30px'
        }}>
          <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0, 245, 255, 0.1)', borderRadius: '12px', padding: '12px 15px' }}>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontFamily: "'Share Tech Mono', monospace" }}>WIFI SSID</span>
            <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff', marginTop: '4px' }}>Airtel_JADHAV</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0, 245, 255, 0.1)', borderRadius: '12px', padding: '12px 15px' }}>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontFamily: "'Share Tech Mono', monospace" }}>TERMINAL IP</span>
            <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#00f5ff', marginTop: '4px' }}>{espIP}</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0, 245, 255, 0.1)', borderRadius: '12px', padding: '12px 15px' }}>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontFamily: "'Share Tech Mono', monospace" }}>WIFI SIGNAL</span>
            <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#07E8', marginTop: '4px' }}>{espRSSI || '-62 dBm'}</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0, 245, 255, 0.1)', borderRadius: '12px', padding: '12px 15px' }}>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontFamily: "'Share Tech Mono', monospace" }}>TERMINAL STATUS</span>
            <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#f81fff', marginTop: '4px', textTransform: 'uppercase' }}>{espState}</div>
          </div>
        </div>

        {/* Multi-Page Navigation Control (Change ESP32 Display Screen) */}
        <div style={{ marginBottom: '30px' }}>
          <span style={{ fontSize: '11px', fontFamily: "'Share Tech Mono', monospace", color: 'rgba(255, 255, 255, 0.4)', display: 'block', marginBottom: '10px' }}>
            &gt; SELECT TERMINAL HUD SCREEN (REMOTE BROWSE MENU)
          </span>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '10px'
          }}>
            {[
              { id: 0, label: 'DASHBOARD' },
              { id: 1, label: 'WI-FI STATS' },
              { id: 2, label: 'JARVIS CORE' },
              { id: 3, label: 'BLE CONSOLE' }
            ].map(page => (
              <button
                key={page.id}
                onClick={() => handlePageSwitch(page.id)}
                style={{
                  background: currentPage === page.id ? 'rgba(0, 245, 255, 0.15)' : 'rgba(0, 0, 0, 0.4)',
                  border: currentPage === page.id ? '2px solid #00f5ff' : '1px solid rgba(0, 245, 255, 0.15)',
                  borderRadius: '10px',
                  padding: '12px 5px',
                  color: currentPage === page.id ? '#00f5ff' : '#fff',
                  fontFamily: "'Share Tech Mono', monospace",
                  fontSize: '12px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: currentPage === page.id ? '0 0 15px rgba(0, 245, 255, 0.25)' : 'none'
                }}
              >
                {page.label}
              </button>
            ))}
          </div>
        </div>

        {/* Reactor Core Central Controller */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          margin: '35px 0'
        }}>
          <button 
            onClick={startListening}
            style={{
              width: '120px',
              height: '120px',
              borderRadius: '50%',
              background: isListening 
                ? 'radial-gradient(circle, rgba(248, 31, 255, 0.22) 0%, rgba(0,0,0,0.85) 100%)' 
                : 'radial-gradient(circle, rgba(0, 245, 255, 0.18) 0%, rgba(0,0,0,0.85) 100%)',
              border: isListening ? '3px solid #f81fff' : '3px solid #00f5ff',
              boxShadow: isListening 
                ? '0 0 45px rgba(248, 31, 255, 0.45), inset 0 0 20px rgba(248, 31, 255, 0.35)' 
                : '0 0 45px rgba(0, 245, 255, 0.35), inset 0 0 20px rgba(0, 245, 255, 0.25)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              outline: 'none',
              transition: 'all 0.3s ease',
              position: 'relative'
            }}
          >
            {/* Dashed outer spinner */}
            <div style={{
              position: 'absolute',
              width: '134px',
              height: '134px',
              borderRadius: '50%',
              border: isListening ? '2px dashed rgba(248, 31, 255, 0.4)' : '2px dashed rgba(0, 245, 255, 0.4)',
              animation: 'spin 8s linear infinite'
            }} />
            
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              backgroundColor: isListening ? '#f81fff' : '#00f5ff',
              boxShadow: isListening ? '0 0 25px #f81fff' : '0 0 25px #00f5ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#000',
              fontWeight: '800',
              fontSize: '13px'
            }}>
              {isListening ? '🎙️' : 'JARVIS'}
            </div>
          </button>
          
          <span style={{
            marginTop: '15px',
            fontSize: '13px',
            letterSpacing: '2px',
            textTransform: 'uppercase',
            fontWeight: '600',
            color: isListening ? '#f81fff' : '#00f5ff'
          }}>
            {isListening ? 'AI STREAMING DIRECT TO BT SPEAKER...' : 'Tap Core to Command'}
          </span>
        </div>

        {/* Text Subtitle Console Panel */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px', marginBottom: '25px' }}>
          
          {/* Transcript Log */}
          <div style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(0, 245, 255, 0.1)', borderRadius: '12px', padding: '15px 20px' }}>
            <span style={{ fontSize: '11px', fontFamily: "'Share Tech Mono', monospace", color: 'rgba(255, 255, 255, 0.35)', display: 'block', marginBottom: '6px' }}>
              &gt; DETECTED_TRANSCRIPT
            </span>
            <p style={{ margin: 0, fontSize: '15px', color: '#fff', fontStyle: 'italic' }}>
              {transcript ? `"${transcript}"` : 'Awaiting input trigger...'}
            </p>
          </div>

          {/* AI Response Subtitle */}
          <div style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(248, 31, 255, 0.15)', borderRadius: '12px', padding: '15px 20px' }}>
            <span style={{ fontSize: '11px', fontFamily: "'Share Tech Mono', monospace", color: 'rgba(255, 255, 255, 0.35)', display: 'block', marginBottom: '6px' }}>
              &gt; STREAMING_RESPONSE_SUBTITLES
            </span>
            <p style={{ 
              margin: 0, 
              fontSize: '17px', 
              color: '#00f5ff', 
              fontFamily: "'Share Tech Mono', monospace",
              lineHeight: '1.4'
            }}>
              {jarvisResponse}
            </p>
          </div>
        </div>

        {/* Text Input Terminal Command Mode */}
        <form onSubmit={handleTextSubmit} style={{ display: 'flex', gap: '10px', marginBottom: bleConnected ? '25px' : '0px' }}>
          <input 
            type="text" 
            placeholder="Input text terminal command directly..."
            value={textModeInput}
            onChange={(e) => setTextModeInput(e.target.value)}
            style={{
              flex: 1,
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(0, 245, 255, 0.25)',
              borderRadius: '8px',
              padding: '12px 15px',
              color: '#fff',
              fontSize: '14px',
              outline: 'none',
              fontFamily: "'Share Tech Mono', monospace"
            }}
          />
          <button 
            type="submit"
            style={{
              background: '#00f5ff',
              border: 'none',
              borderRadius: '8px',
              padding: '0 25px',
              color: '#000',
              fontWeight: '800',
              cursor: 'pointer',
              fontSize: '14px',
              fontFamily: "'Share Tech Mono', monospace"
            }}
          >
            EXEC
          </button>
        </form>

        {/* Local Bluetooth console logger */}
        {bleConnected && (
          <div style={{
            background: 'rgba(0,0,0,0.6)',
            border: '1px solid rgba(7, 232, 100, 0.2)',
            borderRadius: '12px',
            padding: '15px'
          }}>
            <span style={{ fontSize: '11px', fontFamily: "'Share Tech Mono', monospace", color: '#07E8', display: 'block', marginBottom: '8px' }}>
              &gt; LOCAL_BLE_CONSOLE_LOGS
            </span>
            <div style={{
              maxHeight: '100px',
              overflowY: 'auto',
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: '12px',
              color: 'rgba(255,255,255,0.7)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              {bleConsoleLogs.length > 0 ? (
                bleConsoleLogs.map((log, idx) => (
                  <div key={idx} style={{ borderLeft: '2px solid #07E8', paddingLeft: '8px' }}>
                    {log}
                  </div>
                ))
              ) : (
                <div style={{ color: 'rgba(255,255,255,0.3)' }}>No BLE actions logged.</div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Global CSS keyframes for rotation animations */}
      <style jsx global>{`
        @keyframes pulse {
          0% { transform: scale(0.95); opacity: 0.5; }
          50% { transform: scale(1.05); opacity: 1; }
          100% { transform: scale(0.95); opacity: 0.5; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
