// core/static/core/voice.js - hands-free voice commands (browser speech API, needs HTTPS and Chrome/Edge/Safari)
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || document.body.dataset.talk !== "1") return;       // unsupported browser or Talk disabled
  const $ = s => document.querySelector(s);
  const click = s => { const e = $(s); if (e && !e.hidden && !e.disabled) { e.click(); return true; } return false; };
  const say = t => { if (!("speechSynthesis" in window) || !t) return; const u = new SpeechSynthesisUtterance(t);
    window.__muteUntil = Date.now() + 4000; u.onend = u.onerror = () => { window.__muteUntil = Date.now() + 700; }; speechSynthesis.speak(u); };
  const COMMANDS = [   // [words that must appear, action, spoken reply]
    [/new ticket|raise a ticket/, () => click("#new-ticket"), "Opening new ticket"],
    [/\b(book|booking|appointment|place order|new order)\b/, () => click("#new-booking"), "Opening the form. Please check it and press the button yourself"],
    [/\b(faq|help)\b/, () => click("#t-faq"), "Showing help and FAQ"],
    [/\b(activity|calendar)\b/, () => click("#t-act"), "Showing activity"],
    [/\btoday\b/, () => click("#go-today"), "Going to today"],
    [/read aloud|read out/, () => click("#speak"), "Toggling read aloud"],
    [/talk to (the )?team|human|person|back to (the )?assistant/, () => click("#swap"), "Switching chat"],
    [/^send( it| message)?$/, () => click("#send"), ""],
    [/close|cancel/, () => click("dialog[open] [data-close]"), "Closed"],
    [/sign out|log out/, () => say("For safety, please press Sign out yourself"), ""],
  ];
  let rec = null, on = false, starting = false, quickEnds = 0, lastStart = 0;
  const btn = document.createElement("button");
  btn.className = "btn sm"; btn.textContent = "Voice commands: off"; btn.setAttribute("aria-pressed", "false");
  const status = $("#voice-status") || Object.assign(document.createElement("div"), { className: "sm" });
  const bar = document.createElement("div"); bar.className = "row"; bar.style.cssText = "padding:0 12px 8px"; bar.append(btn);
  if (!status.parentNode) $(".composer").before(status);
  status.before(bar);
  const setStatus = t => { status.textContent = t; };

  function off(msg) {
    on = false; const r = rec; rec = null;
    if (r) { r.onaudiostart = r.onresult = r.onerror = r.onend = null; try { r.abort(); } catch (_) {} }
    CareMic.stop(); btn.textContent = "Voice commands: off"; btn.setAttribute("aria-pressed", "false");
    setStatus(msg || "Voice commands are off.");
  }
  function handle(raw) {
    const t = raw.toLowerCase().replace(/[.,!?]/g, "").trim(); if (!t) return;
    setStatus("Heard: " + t);
    if (/^(stop listening|voice off|stop voice)$/.test(t)) return off();
    const ask = t.match(/^(ask|say|tell the assistant|question)\s+(.+)/);   // free text goes to the chat
    if (ask) { $("#msg").value = ask[2].slice(0, 600); click("#send"); return; }
    for (const [re, act, reply] of COMMANDS) if (re.test(t) && act()) { if (reply) say(reply); return; }
    setStatus('Not understood: "' + t + '". Try: new ticket, book, help, today, read aloud, or "ask <question>".');
  }
  function begin(r) { try { lastStart = Date.now(); r.start(); return true; } catch (_) { return false; } }
  function start() {
    const r = new SR(); rec = r; quickEnds = 0; let started = false;
    r.lang = navigator.language || "en-US"; r.continuous = true; r.interimResults = true;
    r.onaudiostart = () => { started = true; if (rec === r && on) setStatus("Listening. Say: new ticket, book, help, today, or ask <question>."); };
    r.onresult = e => {
      if (rec !== r || !on) return;
      const res = e.results[e.results.length - 1], text = res[0].transcript;
      if (Date.now() < (window.__muteUntil || 0)) return;               // that was the page speaking, not the user
      if (res.isFinal) handle(text); else setStatus("Hearing: " + text);   // show progress while speaking, act when the sentence ends
    };
    r.onerror = e => {
      if (rec !== r) return;
      const fatal = { "not-allowed": "Microphone blocked. Click the lock icon in the address bar, allow the microphone, then turn voice on again.",
        "service-not-allowed": "Microphone blocked. Click the lock icon in the address bar, allow the microphone, then turn voice on again.",
        "audio-capture": "No microphone found. Plug one in and turn voice on again.",
        "network": "The browser’s speech service is unreachable (needs internet; Brave and some privacy browsers block it). Voice is off.",
        "language-not-supported": "Your browser language isn’t supported for voice. Voice is off." }[e.error];
      if (fatal) off(fatal); else if (e.error !== "no-speech" && e.error !== "aborted") setStatus("Voice error: " + e.error);
    };
    r.onend = () => {       // browsers end the session after silence: restart it, unless it keeps dying straight away
      if (rec !== r || !on) return;
      quickEnds = Date.now() - lastStart < 1500 ? quickEnds + 1 : 0;
      if (quickEnds >= 5) return off("Voice stopped: the browser keeps closing the microphone. Close other tabs or apps using it, then turn voice on again.");
      setTimeout(() => { if (rec === r && on && !begin(r)) off("Voice stopped. Turn it on again."); }, 300);
    };
    if (!begin(r)) return off("Couldn’t start speech recognition. Try again.");
    setTimeout(() => { if (rec === r && on && !started) off("Speech recognition didn’t start. It works in Chrome, Edge and Safari with an internet connection; Brave and some privacy settings block it."); }, 6000);
  }
  btn.onclick = async () => {
    if (on || starting) return off();
    starting = true; window.dispatchEvent(new CustomEvent("carevoice:claim", { detail: "commands" }));   // the Talk button and this can’t share the microphone
    on = true; btn.textContent = "Voice commands: ON"; btn.setAttribute("aria-pressed", "true"); setStatus("Starting the microphone… allow it if the browser asks.");
    const m = await CareMic.start(); starting = false;
    if (!on) return CareMic.stop();                  // turned off while the permission prompt was open
    if (m.error) return off(m.error);
    start();
  };
  window.addEventListener("carevoice:claim", e => { if (e.detail !== "commands" && on) off("Voice commands paused while you use Talk."); });
})();