// core/static/core/voice.js - hands-free voice commands (browser speech API, needs HTTPS and Chrome/Edge/Safari)
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || document.body.dataset.talk !== "1") return;       // unsupported browser or Talk disabled
  const $ = s => document.querySelector(s);
  const click = s => { const e = $(s); if (e && !e.hidden && !e.disabled) { e.click(); return true; } return false; };
  let muteUntil = 0;                                            // ignore the microphone while the page is speaking, or it hears itself
  const say = t => { if (!("speechSynthesis" in window) || !t) return; const u = new SpeechSynthesisUtterance(t); u.onend = () => { muteUntil = Date.now() + 700; }; speechSynthesis.speak(u); };
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
  let rec = null, on = false, quickEnds = 0, lastStart = 0;
  const btn = document.createElement("button");
  btn.className = "btn sm"; btn.textContent = "Voice commands: off"; btn.setAttribute("aria-pressed", "false");
  const status = $("#voice-status") || Object.assign(document.createElement("div"), { className: "sm" });
  status.setAttribute("aria-live", "polite");
  const bar = document.createElement("div"); bar.className = "row"; bar.style.cssText = "padding:0 12px 8px"; bar.append(btn);
  if (!status.parentNode) $(".composer").before(status);
  status.before(bar);
  const setStatus = t => { status.textContent = t; };

  function off(msg) {
    on = false; const r = rec; rec = null;
    if (r) { r.onstart = r.onresult = r.onerror = r.onend = null; try { r.abort(); } catch (_) {} }
    btn.textContent = "Voice commands: off"; btn.setAttribute("aria-pressed", "false");
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
    const r = new SR(); rec = r; quickEnds = 0;
    r.lang = navigator.language || "en-US"; r.continuous = true; r.interimResults = false;
    r.onstart = () => { if (rec === r && on) setStatus("Listening. Say: new ticket, book, help, today, or ask <question>."); };
    r.onresult = e => {
      if (rec !== r || !on) return;
      if (("speechSynthesis" in window && speechSynthesis.speaking) || Date.now() < muteUntil) return;
      const res = e.results[e.results.length - 1]; if (res.isFinal) handle(res[0].transcript);
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
    if (!begin(r)) off("Couldn’t start the microphone. Try again.");
  }
  btn.onclick = () => {
    if (on) return off();
    window.dispatchEvent(new CustomEvent("carevoice:claim", { detail: "commands" }));   // the Talk button and this can’t share the microphone
    on = true; btn.textContent = "Voice commands: ON"; btn.setAttribute("aria-pressed", "true");
    setStatus("Starting the microphone… allow it if the browser asks."); start();
  };
  window.addEventListener("carevoice:claim", e => { if (e.detail !== "commands" && on) off("Voice commands paused while you use Talk."); });
})();