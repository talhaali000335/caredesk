const B = document.body.dataset;
const NOUN = B.noun, ORDER = B.style === "order";
let date = B.today, month = date.slice(0, 7), lastId = 0, mode = "bot", reading = false;

async function loadDays() {
  const c = await call("/api/calendar?month=" + month), box = $("#days"); box.replaceChildren();
  const ds = Object.keys(c); if (!ds.includes(B.today)) ds.push(B.today);
  ds.sort().reverse().forEach(d => {
    const x = c[d] || {}, n = (x.tickets || 0) + (x.bookings || 0) + (x.queries || 0);
    box.append(h("button", { class: "day", "aria-pressed": d === date, onclick: () => pick(d) }, h("b", {}, fmtDay(d)), h("span", {}, n ? `${n} item${n > 1 ? "s" : ""}` : "No activity")));
  });
}
async function loadDay() {
  const d = await call("/api/day?date=" + date), box = $("#day"); box.replaceChildren();
  const sec = (title, rows, render, none) => box.append(h("div", { class: "sec" }, h("h3", {}, `${title} (${rows.length})`), rows.length ? rows.map(render) : empty(none)));
  sec("Tickets", d.tickets, t => h("div", { class: "item" }, h("div", { class: "grow" }, h("div", { class: "t" }, t.subject), h("div", { class: "meta" }, `Requested ${t.date} · ${t.priority} priority`), t.note && h("div", { class: "meta" }, "Team note: " + t.note)), chip(t.status)), "No tickets requested on this date.");
  sec(NOUN + "s", d.bookings, b => h("div", { class: "item" }, h("div", { class: "grow" }, h("div", { class: "t" }, b.service), h("div", { class: "meta" }, b.when + (b.notes ? " · " + b.notes : ""))), chip(b.status)), `No ${NOUN.toLowerCase()}s on this date.`);
  sec("Your questions", d.queries, q => h("div", { class: "item" }, h("div", { class: "grow" }, h("div", { class: "t" }, q.text), h("div", { class: "meta" }, "Asked at " + q.at))), "You didn’t ask anything on this date.");
}
function pick(d) { date = d; $("#pick").value = d; if (d.slice(0, 7) !== month) month = d.slice(0, 7); refresh(); }
const refresh = () => Promise.all([loadDays(), loadDay()]);
$("#pick").value = date; $("#pick").onchange = e => e.target.value && pick(e.target.value); $("#go-today").onclick = () => pick(B.today);

// tabs + FAQ
function tab(which) {
  $("#activity").hidden = which !== "act"; $("#faq").hidden = which !== "faq";
  $("#t-act").setAttribute("aria-selected", which === "act"); $("#t-faq").setAttribute("aria-selected", which === "faq");
  if (which === "faq") loadFaq();
}
$("#t-act").onclick = () => tab("act"); $("#t-faq").onclick = () => tab("faq");
async function loadFaq() {
  const rows = await call("/api/faqs"), box = $("#faq"); box.replaceChildren();
  if (!rows.length) return box.append(empty("No FAQs yet. Ask the assistant or talk to the team."));
  const names = { ticket: "Tickets", booking: "Bookings", general: "General" };
  ["ticket", "booking", "general"].forEach(cat => {
    const g = rows.filter(r => r.category === cat); if (!g.length) return;
    box.append(h("h3", { style: "margin:14px 0 8px" }, names[cat]));
    g.forEach(f => { const res = h("span", { class: "muted sm" });
      box.append(h("details", { class: "item", style: "display:block" }, h("summary", { class: "t" }, f.question), h("p", {}, f.answer),
        h("div", { class: "row" }, h("span", { class: "sm" }, "Did this solve your question?"),
          h("button", { class: "btn sm", onclick: () => fb(f.id, true, res) }, "Solved"), h("button", { class: "btn sm", onclick: () => fb(f.id, false, res) }, "Not solved"), res)));
    });
  });
}
async function fb(id, solved, out) {
  const r = await call(`/api/faqs/${id}/feedback`, "POST", { solved });
  out.textContent = solved ? "Glad that helped." : r.escalated ? "Sent to the team — continue in the chat." : "Noted.";
  if (!solved) { await poll(); refresh(); }
}

// dialogs
document.querySelectorAll("[data-close]").forEach(b => b.onclick = e => e.target.closest("dialog").close());
$("#new-ticket").onclick = () => $("#dlg-ticket").showModal();
$("#new-booking").onclick = () => $("#dlg-booking").showModal();
$("#tk-go").onclick = async () => { try { await call("/api/ticket", "POST", { subject: $("#tk-s").value, description: $("#tk-d").value, priority: $("#tk-p").value, date: B.today });
  $("#dlg-ticket").close(); $("#tk-s").value = $("#tk-d").value = ""; pick(B.today); } catch (e) { $("#tk-e").textContent = e.message; } };
$("#bk-go").onclick = async () => { try { const w = $("#bk-w").value; await call("/api/booking", "POST", { service: $("#bk-s").value, when: w, notes: $("#bk-n").value, ...(ORDER ? { qty: +$("#bk-q").value, fulfilment: $("#bk-f").value } : {}) });
  $("#dlg-booking").close(); pick(w.slice(0, 10)); } catch (e) { $("#bk-e").textContent = e.message; } };

// chat: the assistant chat and the team chat are two separate conversations; the server returns the one that is active
const box = $("#msgs");
let hint = null;
function setMode(m) {
  mode = m; const p = $("#mode"); p.textContent = m === "human" ? "Care team" : "Assistant"; p.className = "pill " + m;
  $("#chat-title").textContent = m === "human" ? "Chat with the care team" : "Chat with the assistant"; $("#chat").classList.toggle("team", m === "human");
  $("#swap").textContent = m === "human" ? "Back to assistant" : "Talk to team"; $("#swap").hidden = B.human !== "1" && m === "bot";
  $("#msg").placeholder = m === "human" ? "Message the care team" : "Ask about a ticket, booking or policy"; $("#quick").hidden = m === "human";
}
function append(ms) {
  if (ms.length && hint) { hint.remove(); hint = null; }
  ms.forEach(m => { if (m.id > lastId) { lastId = m.id; box.append(bubble(m)); if (reading && m.sender !== "user") speak(m.text); } });
  box.scrollTop = box.scrollHeight;
}
function showHint() {
  if (box.children.length) return;
  hint = h("div", { class: "m " + (mode === "human" ? "team" : "bot") }, mode === "human" ? "You’re connected to the care team. Type your message below and they’ll reply here." : (B.greeting || "How can I help?"));
  box.append(hint);
}
async function poll() {
  const r = await call(`/api/chat?after=${lastId}&mode=${mode}`);
  if (r.reset) { box.replaceChildren(); hint = null; lastId = 0; }      // switched between assistant and team: show that conversation only
  setMode(r.mode); append(r.messages); showHint();
}
let sending = false;
async function send(text) {
  text = (text || $("#msg").value).trim(); if (!text || sending) return;
  sending = true; $("#msg").value = ""; $("#send").disabled = true; $("#send").textContent = "Sending…";
  if (hint) { hint.remove(); hint = null; }
  const pending = bubble({ sender: "user", text, at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }); pending.style.opacity = ".6"; box.append(pending); box.scrollTop = box.scrollHeight;
  try { await call("/api/chat", "POST", { message: text }); pending.remove(); await poll(); refresh(); }
  catch (e) { pending.remove(); $("#msg").value = text; box.append(h("div", { class: "m bot", role: "alert" }, "Message not sent: " + e.message)); box.scrollTop = box.scrollHeight; }
  finally { sending = false; $("#send").disabled = false; $("#send").textContent = "Send"; $("#msg").focus(); }
}
$("#send").onclick = () => send(); $("#msg").onkeydown = e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); send(); } };
$("#swap").onclick = async () => {
  const b = $("#swap"); b.disabled = true;
  try { await call("/api/handoff", "POST", { mode: mode === "bot" ? "human" : "bot" }); await poll(); $("#msg").focus(); }
  catch (e) { box.append(h("div", { class: "m bot", role: "alert" }, e.message)); }
  finally { b.disabled = false; }
};

// talk (browser speech APIs; nothing is sent anywhere except the normal chat call)
function speak(t) { if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(t)); }
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (B.talk === "1") {
  const note = h("div", { id: "voice-status", class: "sm", role: "status", "aria-live": "polite", style: "padding:0 12px 6px;opacity:.85" }); $(".composer").before(note);
  if (SR) {
    const mic = $("#mic"); let micRec = null, got = false;
    const micOff = msg => { const r = micRec; micRec = null; if (r) { r.onresult = r.onerror = r.onend = null; try { r.abort(); } catch (_) {} } mic.textContent = "Talk"; mic.setAttribute("aria-pressed", "false"); if (msg !== undefined) note.textContent = msg; };
    mic.hidden = false; mic.setAttribute("aria-pressed", "false");
    mic.onclick = () => {
      if (micRec) return micOff("");                                                   // tap again to cancel
      window.dispatchEvent(new CustomEvent("carevoice:claim", { detail: "mic" }));     // only one microphone user at a time
      const r = new SR(); micRec = r; got = false; r.lang = navigator.language || "en-US"; r.interimResults = true; r.continuous = false;
      r.onresult = e => { let t = ""; for (const x of e.results) t += x[0].transcript; $("#msg").value = t.slice(0, 600); got = e.results[e.results.length - 1].isFinal; };
      r.onerror = e => { if (micRec !== r) return;
        const why = { "not-allowed": "Microphone blocked. Click the lock icon in the address bar and allow the microphone.", "service-not-allowed": "Microphone blocked. Click the lock icon in the address bar and allow the microphone.",
          "no-speech": "I didn’t hear anything. Tap Talk and try again.", "audio-capture": "No microphone found.", "network": "Speech service unreachable. Check your internet." }[e.error];
        if (e.error !== "aborted") micOff(why || "Voice error: " + e.error); };
      r.onend = () => { if (micRec !== r) return; const ok = got && $("#msg").value.trim(); micOff(""); if (ok) send(); };
      try { r.start(); mic.textContent = "Listening… tap to cancel"; mic.setAttribute("aria-pressed", "true"); note.textContent = "Speak now."; } catch (_) { micOff("Couldn’t start the microphone. Try again."); }
    };
    window.addEventListener("carevoice:claim", e => { if (e.detail !== "mic" && micRec) micOff(""); });
  }
  if ("speechSynthesis" in window) { const s = $("#speak"); s.hidden = false; s.onclick = () => { reading = !reading; s.setAttribute("aria-pressed", reading); s.textContent = reading ? "Reading on" : "Read aloud"; if (!reading) speechSynthesis.cancel(); }; }
}
(B.prompts ? B.prompts.split("|") : []).forEach(p => $("#quick").append(h("button", { onclick: () => send(p) }, p)));
(async () => { try { await poll(); } catch (e) { box.append(h("div", { class: "m bot" }, e.message)); } refresh(); setInterval(() => poll().catch(() => {}), 5000); })();