// core/static/core/voice.js - hands-free voice commands (browser speech API, needs HTTPS)
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || document.body.dataset.talk !== "1") return;       // unsupported browser or Talk disabled
  const $ = s => document.querySelector(s);
  const click = s => { const e = $(s); if (e && !e.hidden) { e.click(); return true; } return false; };
  const say = t => { if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(t)); };
  const COMMANDS = [   // [words that must appear, action, spoken reply]
    [/new ticket|raise a ticket/, () => click("#new-ticket"), "Opening new ticket"],
    [/\b(book|booking|appointment|place order|new order)\b/, () => click("#new-booking"), "Opening the form. Please check it and press the button yourself"],
    [/\b(faq|help)\b/, () => click("#t-faq"), "Showing help and FAQ"],
    [/\b(activity|calendar)\b/, () => click("#t-act"), "Showing activity"],
    [/\btoday\b/, () => click("#go-today"), "Going to today"],
    [/read aloud|read out/, () => click("#speak"), "Toggling read aloud"],
    [/talk to (the )?team|human|person/, () => click("#swap"), "Switching chat mode"],
    [/close|cancel/, () => click("dialog[open] [data-close]"), "Closed"],
    [/sign out|log out/, () => say("For safety, please press Sign out yourself"), ""],
  ];
  let rec = null, on = false;
  const btn = document.createElement("button");
  btn.className = "btn"; btn.textContent = "Voice commands: off"; btn.setAttribute("aria-pressed", "false");
  const status = document.createElement("div");
  status.className = "muted sm"; status.setAttribute("aria-live", "polite");
  const composer = $(".composer"); composer.before(status); composer.prepend(btn);

  function handle(raw) {
    const t = raw.toLowerCase().replace(/[.,!?]/g, "").trim();
    status.textContent = "Heard: " + t;
    if (/^(stop listening|voice off)$/.test(t)) return stop();
    const ask = t.match(/^(ask|say|tell the assistant|question)\s+(.+)/);   // free text goes to the chat
    if (ask) { $("#msg").value = ask[2].slice(0, 600); click("#send"); return; }
    for (const [re, act, reply] of COMMANDS) if (re.test(t) && act()) { if (reply) say(reply); return; }
    status.textContent = 'Not understood: "' + t + '". Try: new ticket, book, help, today, read aloud, or "ask <question>".';
  }
  function start() {
    rec = new SR(); rec.lang = navigator.language; rec.continuous = true; rec.interimResults = false;
    rec.onresult = e => handle(e.results[e.results.length - 1][0].transcript);
    rec.onerror = e => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { status.textContent = "Microphone blocked. Click the lock icon in the address bar and allow the microphone."; stop(); }
      else if (e.error === "network") status.textContent = "Speech service unreachable. Check your internet.";
      else if (e.error !== "no-speech" && e.error !== "aborted") status.textContent = "Voice error: " + e.error;
    };
    rec.onend = () => { if (on) setTimeout(() => { try { rec.start(); } catch (_) {} }, 400); };  // browsers stop after silence: restart
    rec.start();
  }
  function stop() { on = false; if (rec) rec.stop(); btn.textContent = "Voice commands: off"; btn.setAttribute("aria-pressed", "false"); }
  btn.onclick = () => {
    if (on) return stop();
    on = true; btn.textContent = "Voice commands: ON"; btn.setAttribute("aria-pressed", "true");
    status.textContent = "Listening. Say: new ticket, book, help, today, or ask <question>."; start();
  };
})();
