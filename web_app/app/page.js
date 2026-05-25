'use client';

import React, { useState, useEffect, useRef } from 'react';

export default function JarvisDashboard() {
  const [status, setStatus] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [jarvisResponse, setJarvisResponse] = useState('JARVIS SYSTEM ONLINE. Say "Hey Jarvis" to begin.');
  const [isListening, setIsListening] = useState(false);
  const [textModeInput, setTextModeInput] = useState('');
  const [wakeWordActive, setWakeWordActive] = useState(false);
  const [chatHistory, setChatHistory] = useState([]);
  const pendingActionRef = useRef(null);
  const isProcessingRef = useRef(false);
  const wakeDetectedRef = useRef(false);

  // Wi-Fi Sync Telemetry
  const [espIP, setEspIP] = useState('0.0.0.0');
  const [espRSSI, setEspRSSI] = useState('Offline');
  const [espState, setEspState] = useState('Idle');
  const [currentPage, setCurrentPage] = useState(2);

  // Web Bluetooth (BLE) State
  const [bleDevice, setBleDevice] = useState(null);
  const [bleConnected, setBleConnected] = useState(false);
  const [bleConsoleLogs, setBleConsoleLogs] = useState([]);
  const [txCharacteristic, setTxCharacteristic] = useState(null);
  const [rxCharacteristic, setRxCharacteristic] = useState(null);

  // Music & Task State
  const [musicQuery, setMusicQuery] = useState(null);
  const [timerActive, setTimerActive] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerLabel, setTimerLabel] = useState('');

  const recognitionRef = useRef(null);
  const synthRef = useRef(null);
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const audioCtxRef = useRef(null);
  const timerRef = useRef(null);

  const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
  const TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

  // ── Web Audio API Cybernetic Sound Chimes ────────────────────
  const playSoundEffect = (type) => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      if (type === 'click') {
        osc.type = 'sine'; osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.08);
        gain.gain.setValueAtTime(0.08, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now); osc.stop(now + 0.08);
      } else if (type === 'boot') {
        osc.type = 'triangle'; osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.35);
        gain.gain.setValueAtTime(0.12, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now); osc.stop(now + 0.35);
      } else if (type === 'success') {
        osc.type = 'sine'; osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.1);
        gain.gain.setValueAtTime(0.06, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now); osc.stop(now + 0.3);
      } else if (type === 'listening') {
        osc.type = 'sine'; osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.15);
        gain.gain.setValueAtTime(0.06, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now); osc.stop(now + 0.15);
      }
    } catch (e) {}
  };

  // ── Single Continuous Speech Recognition (Wake Word + Command) ──
  useEffect(() => {
    playSoundEffect('boot');

    if (typeof window !== 'undefined') {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        const rec = new SR();
        rec.continuous = false;
        rec.interimResults = false;
        rec.lang = 'en-US';

        rec.onstart = () => {
          setIsListening(true);
          setWakeWordActive(true);
          updateServerStatus('thinking', 'LISTENING...');
        };

        rec.onresult = (event) => {
          const text = event.results[0][0].transcript.trim();
          if (text.length > 0) {
            setTranscript(text);
            // Strip wake word if present
            let command = text
              .replace(/hey\s*jarvis\s*/gi, '')
              .replace(/jarvis\s*/gi, '')
              .trim();
            if (command.length < 2) command = text;
            handleSendToGemini(command);
          }
        };

        rec.onerror = () => {
          setIsListening(false);
          setWakeWordActive(false);
          updateServerStatus('idle', 'TAP MIC TO SPEAK');
        };

        rec.onend = () => {
          setIsListening(false);
          setWakeWordActive(false);
        };

        recognitionRef.current = rec;
      }
      synthRef.current = window.speechSynthesis;
      synthRef.current.getVoices();
      window.speechSynthesis.onvoiceschanged = () => synthRef.current.getVoices();
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        setEspState(data.status);
        if (data.ip) setEspIP(data.ip);
        if (data.rssi) setEspRSSI(data.rssi + " dBm");
        if (data.status === 'trigger_listening') startListening();
      } catch (err) {}
    }, 1000);

    initCanvasSpectrogram();

    return () => {
      clearInterval(interval);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      try { recognitionRef.current?.stop(); } catch(e) {}
    };
  }, []);

  // ── Vector Audio Spectrogram Renderer ────────────────────────
  const initCanvasSpectrogram = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let phase = 0;

    const render = () => {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      phase += 0.08;

      const lines = 3;
      const midY = canvas.height / 2;

      for (let l = 0; l < lines; l++) {
        ctx.beginPath();
        ctx.lineWidth = l === 0 ? 3 : 1.2;
        
        // Cyber Colors: Cyan, Magenta, Purple
        if (status === 'speaking') {
          ctx.strokeStyle = l === 0 ? '#f81fff' : l === 1 ? 'rgba(0, 245, 255, 0.4)' : 'rgba(255, 255, 255, 0.15)';
        } else if (status === 'thinking') {
          ctx.strokeStyle = l === 0 ? '#FD20' : l === 1 ? 'rgba(255, 255, 255, 0.3)' : 'rgba(254, 150, 0, 0.15)';
        } else {
          ctx.strokeStyle = l === 0 ? '#00f5ff' : l === 1 ? 'rgba(7, 232, 100, 0.4)' : 'rgba(0, 245, 255, 0.1)';
        }

        for (let x = 0; x < canvas.width; x++) {
          let amplitude = 12; // Default Idle pulse
          let frequency = 0.02;

          if (status === 'speaking') {
            amplitude = Math.sin(phase * 1.5) * 22 + 10;
            frequency = 0.04;
          } else if (isListening) {
            amplitude = Math.random() * 26 + 6;
            frequency = 0.06;
          } else if (status === 'thinking') {
            amplitude = Math.cos(phase * 2) * 8 + 15;
            frequency = 0.08;
          }

          const y = midY + Math.sin(x * frequency + phase + l * 0.8) * amplitude * Math.sin(x * Math.PI / canvas.width);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      animationRef.current = requestAnimationFrame(render);
    };

    render();
  };

  // ── Web Bluetooth (BLE) ──────────────────────────────────────
  const addBleLog = (msg) => {
    setBleConsoleLogs(prev => [msg, ...prev.slice(0, 8)]);
  };

  const connectLocalBLE = async () => {
    if (!navigator.bluetooth) {
      alert("Web Bluetooth is not supported on this browser. Try Chrome/Edge or Blueify on iOS.");
      return;
    }
    playSoundEffect('click');

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
      const rxChar = await service.getCharacteristic(RX_UUID);
      setRxCharacteristic(rxChar);
      
      const txChar = await service.getCharacteristic(TX_UUID);
      setTxCharacteristic(txChar);
      
      await txChar.startNotifications();
      txChar.addEventListener('characteristicvaluechanged', handleBleNotification);
      
      setBleConnected(true);
      playSoundEffect('success');
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
    addBleLog(`Notification: ${value}`);
    try {
      const data = JSON.parse(value);
      if (data.trigger === 'mic') {
        startListening();
      }
    } catch (e) {}
  };

  const sendBleCommand = async (commandObj) => {
    if (!bleConnected || !rxCharacteristic) return;
    try {
      const jsonStr = JSON.stringify(commandObj);
      const encoder = new TextEncoder();
      await rxCharacteristic.writeValue(encoder.encode(jsonStr));
    } catch (err) {
      addBleLog(`Write Error: ${err.message}`);
    }
  };

  // ── Unified Communication Handlers ───────────────────────────
  const updateServerStatus = async (statusStr, textStr) => {
    setStatus(statusStr);
    
    try {
      await fetch('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusStr, text: textStr })
      });
    } catch (e) {}

    if (bleConnected) {
      sendBleCommand({ status: statusStr, text: textStr });
    }
  };

  const handlePageSwitch = async (pageNumber) => {
    setCurrentPage(pageNumber);
    playSoundEffect('click');
    
    try {
      await fetch('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: 'page', v: pageNumber })
      });
    } catch (e) {}

    if (bleConnected) {
      sendBleCommand({ cmd: 'page', v: pageNumber });
    }
  };

  const startListening = () => {
    playSoundEffect('listening');
    if (synthRef.current?.speaking) synthRef.current.cancel();
    try { recognitionRef.current?.stop(); } catch(e) {}
    setTimeout(() => {
      try { recognitionRef.current?.start(); } catch(e) {}
    }, 100);
  };

  // ── Action Dispatcher ─────────────────────────────────────────
  const executeAction = (action, data) => {
    // Store action for user-gesture execution if popup blocked
    pendingActionRef.current = { action, data };

    switch (action) {
      case 'play_music':
        if (data?.query) {
          setMusicQuery(data.query);
          playSoundEffect('success');
        }
        break;
      case 'set_timer': {
        const secs = parseInt(data?.seconds) || 60;
        setTimerSeconds(secs);
        setTimerLabel(data?.label || 'Timer');
        setTimerActive(true);
        if (timerRef.current) clearInterval(timerRef.current);
        let remaining = secs;
        timerRef.current = setInterval(() => {
          remaining--;
          setTimerSeconds(remaining);
          if (remaining <= 0) {
            clearInterval(timerRef.current);
            setTimerActive(false);
            playSoundEffect('success');
            speakResponse('Sir, your timer has completed.');
          }
        }, 1000);
        break;
      }
      case 'open_url':
        if (data?.url) window.open(data.url, '_blank');
        break;
      case 'search_web':
        if (data?.query) window.open(`https://www.google.com/search?q=${encodeURIComponent(data.query)}`, '_blank');
        break;
      case 'get_time': break;
      case 'get_weather':
        if (data?.city) window.open(`https://wttr.in/${encodeURIComponent(data.city)}`, '_blank');
        break;
      default: break;
    }
  };

  const handleSendToGemini = async (promptText) => {
    updateServerStatus('thinking', 'JARVIS CORE PROCESSING...');
    setJarvisResponse('Analyzing neural pathways...');
    setChatHistory(prev => [...prev, { role: 'user', text: promptText }]);
    
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText })
      });
      const data = await res.json();

      if (data.response) {
        setJarvisResponse(data.response);
        setChatHistory(prev => [...prev, { role: 'jarvis', text: data.response }]);
        speakResponse(data.response);
        if (data.action && data.action !== 'none') {
          executeAction(data.action, data.data);
        }
      } else {
        throw new Error(data.error || 'AI Module Timeout');
      }
    } catch (err) {
      setJarvisResponse(`Neural Error: ${err.message}`);
      updateServerStatus('idle', 'JARVIS STANDBY');
      isProcessingRef.current = false;
      setIsListening(false);
      try { recognitionRef.current?.start(); } catch(e) {}
    }
  };

  const speakResponse = (textToSpeak) => {
    if (!synthRef.current) return;

    // Forces SpeechSynthesis directly to default local phone/laptop speakers
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    const voices = synthRef.current.getVoices();
    
    // Aggressively seek a DEEP MALE voice for commanding JARVIS persona
    // Priority: Daniel (British Male) > Aaron > Google UK Male > any en-GB male > any en male
    const maleVoicePatterns = [
      v => v.name.includes('Daniel'),          // macOS British Male – deep & authoritative
      v => v.name.includes('Aaron'),            // macOS US Male – smooth & clear  
      v => v.name.includes('Arthur'),           // macOS UK Male
      v => v.name.includes('James'),            // Some systems
      v => v.name.includes('Google UK English Male'),
      v => v.name.includes('Male') && v.lang.includes('en-GB'),
      v => v.name.includes('Male') && v.lang.includes('en'),
      v => v.lang.includes('en-GB'),            // British accent fallback
      v => v.lang.includes('en-US'),            // American fallback
    ];

    let selectedVoice = null;
    for (const pattern of maleVoicePatterns) {
      selectedVoice = voices.find(pattern);
      if (selectedVoice) break;
    }
    if (selectedVoice) utterance.voice = selectedVoice;
    
    // Deep, authoritative male cadence
    utterance.rate = 0.95;    // Slightly slower – commanding
    utterance.pitch = 0.85;   // Lower pitch – deep male tone

    // Stream waveform data to ESP32 display during speech
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
      playSoundEffect('success');
      isProcessingRef.current = false;
      setIsListening(false);
      wakeDetectedRef.current = false;
      // Restart continuous recognition after speaking
      setTimeout(() => {
        try { recognitionRef.current?.start(); } catch(e) {}
      }, 500);
    };

    synthRef.current.speak(utterance);
  };

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (!textModeInput.trim()) return;
    playSoundEffect('click');
    setTranscript(textModeInput);
    handleSendToGemini(textModeInput);
    setTextModeInput('');
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(circle at 50% 50%, #03081e 0%, #00020a 100%)',
      padding: '40px 20px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      fontFamily: "'Share Tech Mono', monospace"
    }}>
      
      {/* Premium Cyberpunk Scanlines and Grid Overlays */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.03), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.03))',
        backgroundSize: '100% 4px, 6px 100%',
        pointerEvents: 'none',
        zIndex: 5
      }} />

      {/* Cyber Grid */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundImage: 'linear-gradient(rgba(0, 245, 255, 0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 245, 255, 0.02) 1px, transparent 1px)',
        backgroundSize: '30px 30px',
        pointerEvents: 'none',
        zIndex: 1
      }} />

      {/* Main Premium Interface Panel */}
      <div style={{
        width: '100%',
        maxWidth: '850px',
        background: 'linear-gradient(135deg, rgba(8, 14, 28, 0.75) 0%, rgba(2, 4, 12, 0.9) 100%)',
        backdropFilter: 'blur(30px)',
        border: '2px solid rgba(0, 245, 255, 0.45)',
        borderRadius: '30px',
        padding: '35px',
        boxShadow: '0 0 80px rgba(0, 245, 255, 0.18), inset 0 0 30px rgba(0, 245, 255, 0.1)',
        zIndex: 10,
        boxSizing: 'border-box',
        position: 'relative'
      }}>
        
        {/* Glow corners */}
        <div style={{ position: 'absolute', width: '20px', height: '20px', borderTop: '3px solid #00f5ff', borderLeft: '3px solid #00f5ff', top: '-2px', left: '-2px' }} />
        <div style={{ position: 'absolute', width: '20px', height: '20px', borderTop: '3px solid #00f5ff', borderRight: '3px solid #00f5ff', top: '-2px', right: '-2px' }} />
        <div style={{ position: 'absolute', width: '20px', height: '20px', borderBottom: '3px solid #00f5ff', borderLeft: '3px solid #00f5ff', bottom: '-2px', left: '-2px' }} />
        <div style={{ position: 'absolute', width: '20px', height: '20px', borderBottom: '3px solid #00f5ff', borderRight: '3px solid #00f5ff', bottom: '-2px', right: '-2px' }} />

        {/* Dashboard Title & Audio Selector */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '15px',
          borderBottom: '2px solid rgba(0, 245, 255, 0.35)',
          paddingBottom: '20px',
          marginBottom: '30px'
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '32px', fontWeight: '900', letterSpacing: '4px', color: '#00f5ff', textShadow: '0 0 15px rgba(0, 245, 255, 0.6)' }}>
              JARVIS HUD
            </h1>
            <span style={{ fontSize: '11px', color: '#07E8', letterSpacing: '2px', opacity: 0.85 }}>
              ⚡ ONLINE LINK // SPEAKER SOURCE: DEFAULT DEVICE (LOCAL AUDIO ACTIVE)
            </span>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button 
              onClick={connectLocalBLE}
              style={{
                background: bleConnected ? 'rgba(7, 232, 100, 0.15)' : 'rgba(0, 0, 0, 0.5)',
                border: bleConnected ? '2px solid #07E8' : '1px solid rgba(0, 245, 255, 0.35)',
                borderRadius: '8px',
                padding: '8px 16px',
                fontSize: '11px',
                color: bleConnected ? '#07E8' : '#00f5ff',
                cursor: 'pointer',
                fontWeight: 'bold',
                transition: 'all 0.3s ease',
                boxShadow: bleConnected ? '0 0 15px rgba(7, 232, 100, 0.3)' : 'none'
              }}
            >
              {bleConnected ? '🟢 BLE ACTIVE' : '🔌 PAIR BLE'}
            </button>
          </div>
        </div>

        {/* Dynamic Vector Spectrogram Waves */}
        <div style={{
          background: 'rgba(0, 0, 0, 0.6)',
          border: '1px solid rgba(0, 245, 255, 0.2)',
          borderRadius: '16px',
          padding: '10px',
          marginBottom: '30px',
          position: 'relative',
          display: 'flex',
          justifyContent: 'center',
          boxShadow: 'inset 0 0 15px rgba(0,245,255,0.05)'
        }}>
          <span style={{ position: 'absolute', left: '15px', top: '10px', fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>
            NATIVE SPECTRUM ANALYZER
          </span>
          <canvas ref={canvasRef} width="780" height="75" style={{ width: '100%', height: '75px' }} />
        </div>

        {/* Dynamic Telemetry Info Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '15px',
          marginBottom: '30px'
        }}>
          {[
            { label: 'LOCAL WI-FI SSID', value: 'Airtel_JADHAV', color: '#fff' },
            { label: 'TERMINAL IP ADDR', value: espIP, color: '#00f5ff' },
            { label: 'WIFI SIGN (RSSI)', value: espRSSI, color: '#07E8' },
            { label: 'DEVICE CORE STATE', value: espState, color: '#f81fff' }
          ].map((card, idx) => (
            <div key={idx} style={{
              background: 'linear-gradient(135deg, rgba(0, 245, 255, 0.03) 0%, rgba(0, 0, 0, 0.45) 100%)',
              border: '1px solid rgba(0, 245, 255, 0.15)',
              borderRadius: '14px',
              padding: '15px',
              position: 'relative',
              boxShadow: '0 4px 10px rgba(0,0,0,0.2)'
            }}>
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: '4px' }}>{card.label}</span>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: card.color, textTransform: 'uppercase' }}>{card.value}</div>
            </div>
          ))}
        </div>

        {/* Remote Page Index Selection Control */}
        <div style={{ marginBottom: '35px' }}>
          <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.45)', display: 'block', marginBottom: '10px', letterSpacing: '1px' }}>
            &gt; SYSTEM NAVIGATOR // SWITCH TERMINAL PAGES:
          </span>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '12px'
          }}>
            {[
              { id: 0, label: '01 / DASH' },
              { id: 1, label: '02 / WIFI' },
              { id: 2, label: '03 / JARVIS' },
              { id: 3, label: '04 / CONSOLE' }
            ].map(page => (
              <button
                key={page.id}
                onClick={() => handlePageSwitch(page.id)}
                style={{
                  background: currentPage === page.id ? 'rgba(0, 245, 255, 0.2)' : 'rgba(0, 0, 0, 0.55)',
                  border: currentPage === page.id ? '2px solid #00f5ff' : '1px solid rgba(0, 245, 255, 0.2)',
                  borderRadius: '12px',
                  padding: '14px 5px',
                  color: currentPage === page.id ? '#00f5ff' : 'rgba(255, 255, 255, 0.8)',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                  boxShadow: currentPage === page.id ? '0 0 20px rgba(0, 245, 255, 0.3)' : 'none'
                }}
              >
                {page.label}
              </button>
            ))}
          </div>
        </div>

        {/* Neon Reactor Trigger Core */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          margin: '35px 0'
        }}>
          <button 
            onClick={startListening}
            style={{
              width: '130px',
              height: '130px',
              borderRadius: '50%',
              background: isListening 
                ? 'radial-gradient(circle, rgba(248, 31, 255, 0.25) 0%, rgba(0,0,0,0.9) 100%)' 
                : 'radial-gradient(circle, rgba(0, 245, 255, 0.2) 0%, rgba(0,0,0,0.9) 100%)',
              border: isListening ? '3px solid #f81fff' : '3px solid #00f5ff',
              boxShadow: isListening 
                ? '0 0 50px rgba(248, 31, 255, 0.55), inset 0 0 25px rgba(248, 31, 255, 0.4)' 
                : '0 0 50px rgba(0, 245, 255, 0.4), inset 0 0 25px rgba(0, 245, 255, 0.3)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              outline: 'none',
              transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
              position: 'relative'
            }}
          >
            {/* Spinning Outer Ring */}
            <div style={{
              position: 'absolute',
              width: '146px',
              height: '146px',
              borderRadius: '50%',
              border: isListening ? '2px dashed rgba(248, 31, 255, 0.5)' : '2px dashed rgba(0, 245, 255, 0.5)',
              animation: 'spin 12s linear infinite'
            }} />
            
            <div style={{
              width: '42px',
              height: '42px',
              borderRadius: '50%',
              backgroundColor: isListening ? '#f81fff' : '#00f5ff',
              boxShadow: isListening ? '0 0 30px #f81fff' : '0 0 30px #00f5ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#000',
              fontWeight: 'bold',
              fontSize: '14px'
            }}>
              {isListening ? '🎙️' : 'MIC'}
            </div>
          </button>
          
          <span style={{
            marginTop: '20px',
            fontSize: '13px',
            letterSpacing: '3px',
            textTransform: 'uppercase',
            fontWeight: 'bold',
            color: isListening ? '#f81fff' : '#00f5ff',
            textShadow: isListening ? '0 0 8px rgba(248, 31, 255, 0.5)' : '0 0 8px rgba(0, 245, 255, 0.5)'
          }}>
            {isListening ? '🎤 LISTENING...' : '🔵 TAP TO SPEAK'}
          </span>
        </div>

        {/* Dual Dialog Console */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px', marginBottom: '25px' }}>
          
          <div style={{ background: 'rgba(0,0,0,0.65)', border: '1px solid rgba(0, 245, 255, 0.25)', borderRadius: '14px', padding: '20px' }}>
            <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.45)', display: 'block', marginBottom: '8px' }}>
              &gt; SPEECH TRANSCRIPT INPUT:
            </span>
            <p style={{ margin: 0, fontSize: '16px', color: '#fff', fontStyle: 'italic', lineHeight: '1.4' }}>
              {transcript ? `"${transcript}"` : 'Awaiting speech or manual input...'}
            </p>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.65)', border: '1px solid rgba(248, 31, 255, 0.3)', borderRadius: '14px', padding: '20px' }}>
            <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.45)', display: 'block', marginBottom: '8px' }}>
              &gt; SYSTEM CORE RESPONSE:
            </span>
            <p style={{ 
              margin: 0, 
              fontSize: '18px', 
              color: '#00f5ff', 
              lineHeight: '1.5',
              textShadow: '0 0 10px rgba(0, 245, 255, 0.25)'
            }}>
              {jarvisResponse}
            </p>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '15px' }}>
          {[
            { label: '🎵 Play Music', cmd: 'Play some lofi hip hop beats' },
            { label: '⏱ 5min Timer', cmd: 'Set a timer for 5 minutes' },
            { label: '😂 Tell Joke', cmd: 'Tell me a funny joke' },
            { label: '🌤 Weather', cmd: 'What is the weather in Pune?' },
            { label: '🕐 Time', cmd: 'What time is it right now?' },
            { label: '🔍 Search', cmd: 'Search for latest tech news' },
          ].map((btn, i) => (
            <button key={i} onClick={() => { setTranscript(btn.cmd); handleSendToGemini(btn.cmd); }} style={{
              background: 'rgba(0,245,255,0.08)', border: '1px solid rgba(0,245,255,0.25)',
              borderRadius: '20px', padding: '6px 14px', color: '#00f5ff', fontSize: '12px',
              cursor: 'pointer', fontFamily: "'Share Tech Mono', monospace", transition: 'all 0.2s',
              whiteSpace: 'nowrap'
            }}
            onMouseEnter={e => { e.target.style.background = 'rgba(0,245,255,0.2)'; e.target.style.borderColor = '#00f5ff'; }}
            onMouseLeave={e => { e.target.style.background = 'rgba(0,245,255,0.08)'; e.target.style.borderColor = 'rgba(0,245,255,0.25)'; }}
            >{btn.label}</button>
          ))}
        </div>

        {/* TFT Page Navigation */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '15px' }}>
          {['📊 Dashboard', '📡 Wi-Fi', '🔮 AI Core', '📱 BLE'].map((label, idx) => (
            <button key={idx} onClick={() => handlePageSwitch(idx)} style={{
              flex: 1, padding: '8px 4px', fontSize: '11px', cursor: 'pointer',
              fontFamily: "'Share Tech Mono', monospace",
              background: currentPage === idx ? 'rgba(0,245,255,0.15)' : 'rgba(0,0,0,0.4)',
              border: currentPage === idx ? '1px solid #00f5ff' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              color: currentPage === idx ? '#00f5ff' : 'rgba(255,255,255,0.5)',
              transition: 'all 0.2s'
            }}>{label}</button>
          ))}
        </div>

        {/* Chat History */}
        {chatHistory.length > 0 && (
          <div style={{
            background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '12px', padding: '12px', marginBottom: '15px',
            maxHeight: '200px', overflowY: 'auto'
          }}>
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', letterSpacing: '1px' }}>
              CONVERSATION LOG ({chatHistory.length} messages)
            </span>
            {chatHistory.slice(-10).map((msg, i) => (
              <div key={i} style={{
                padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
                fontSize: '13px', lineHeight: '1.4'
              }}>
                <span style={{ color: msg.role === 'user' ? '#f81fff' : '#00f5ff', fontSize: '10px' }}>
                  {msg.role === 'user' ? '> YOU: ' : '> JARVIS: '}
                </span>
                <span style={{ color: msg.role === 'user' ? 'rgba(255,255,255,0.7)' : '#00f5ff' }}>
                  {msg.text}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Exec Input Form */}
        <form onSubmit={handleTextSubmit} style={{ display: 'flex', gap: '12px', marginBottom: bleConnected ? '25px' : '0px' }}>
          <input 
            type="text" 
            placeholder="Type your command directly..."
            value={textModeInput}
            onChange={(e) => setTextModeInput(e.target.value)}
            style={{
              flex: 1,
              background: 'rgba(0, 0, 0, 0.6)',
              border: '1px solid rgba(0, 245, 255, 0.35)',
              borderRadius: '10px',
              padding: '15px 18px',
              color: '#fff',
              fontSize: '15px',
              outline: 'none',
              fontFamily: "'Share Tech Mono', monospace",
              transition: 'all 0.3s ease',
              boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)'
            }}
            onFocus={(e) => e.target.style.border = '1px solid #00f5ff'}
            onBlur={(e) => e.target.style.border = '1px solid rgba(0, 245, 255, 0.35)'}
          />
          <button 
            type="submit"
            style={{
              background: '#00f5ff',
              border: 'none',
              borderRadius: '10px',
              padding: '0 30px',
              color: '#000',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '15px',
              fontFamily: "'Share Tech Mono', monospace",
              boxShadow: '0 0 15px rgba(0, 245, 255, 0.35)',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => e.target.style.transform = 'scale(1.02)'}
            onMouseLeave={(e) => e.target.style.transform = 'scale(1.0)'}
          >
            EXEC
          </button>
        </form>

        {/* Music Player Widget */}
        {musicQuery && (
          <div style={{
            background: 'rgba(0,0,0,0.7)',
            border: '1px solid rgba(248, 31, 255, 0.35)',
            borderRadius: '14px',
            padding: '15px',
            marginTop: '20px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '12px', color: '#f81fff', fontWeight: 'bold' }}>
                ♪ {musicQuery.toUpperCase()}
              </span>
              <button onClick={() => setMusicQuery(null)} style={{
                background: 'none', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px',
                color: '#fff', padding: '4px 10px', fontSize: '11px', cursor: 'pointer'
              }}>✕ CLOSE</button>
            </div>
            <iframe
              width="100%" height="152"
              src={`https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(musicQuery)}&autoplay=1`}
              allow="autoplay; encrypted-media"
              allowFullScreen
              style={{ border: 'none', borderRadius: '10px', background: '#000' }}
              title="JARVIS Music Player"
            />
          </div>
        )}

        {/* Active Timer Widget */}
        {timerActive && (
          <div style={{
            background: 'rgba(0,0,0,0.7)',
            border: '1px solid rgba(7, 232, 100, 0.4)',
            borderRadius: '14px',
            padding: '15px',
            marginTop: '15px',
            display: 'flex',
            alignItems: 'center',
            gap: '15px'
          }}>
            <div style={{
              width: '50px', height: '50px', borderRadius: '50%',
              border: '3px solid #07E864',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '18px', fontWeight: 'bold', color: '#07E864',
              boxShadow: '0 0 15px rgba(7, 232, 100, 0.3)',
              animation: 'pulse 1s ease-in-out infinite'
            }}>
              {timerSeconds}
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>⏱ ACTIVE TIMER</div>
              <div style={{ fontSize: '15px', color: '#07E864', fontWeight: 'bold' }}>{timerLabel}</div>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }}>
                {Math.floor(timerSeconds / 60)}:{String(timerSeconds % 60).padStart(2, '0')} remaining
              </div>
            </div>
            <button onClick={() => { clearInterval(timerRef.current); setTimerActive(false); }} style={{
              marginLeft: 'auto', background: 'none', border: '1px solid rgba(255,100,100,0.4)',
              borderRadius: '8px', color: '#ff6464', padding: '6px 12px', fontSize: '11px', cursor: 'pointer'
            }}>CANCEL</button>
          </div>
        )}

        {/* BLE Logs Console */}
        {bleConnected && (
          <div style={{
            background: 'rgba(0,0,0,0.75)',
            border: '1px solid rgba(7, 232, 100, 0.25)',
            borderRadius: '14px',
            padding: '20px'
          }}>
            <span style={{ fontSize: '11px', color: '#07E8', display: 'block', marginBottom: '10px' }}>
              &gt; LOCAL BLE DIALOG STREAM:
            </span>
            <div style={{
              maxHeight: '100px',
              overflowY: 'auto',
              fontSize: '12px',
              color: 'rgba(255, 255, 255, 0.75)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              {bleConsoleLogs.length > 0 ? (
                bleConsoleLogs.map((log, idx) => (
                  <div key={idx} style={{ borderLeft: '2px solid #07E8', paddingLeft: '10px' }}>
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

      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(0.95); }
        }
      `}</style>
    </div>
  );
}
