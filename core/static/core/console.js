const IS_SUPER = document.body.dataset.super === "1";
let ctx, tabName = "customers", uid = null, qDate = "", tenantQ = "";
const q = (u) => u + (tenantQ ? (u.includes("?") ? "&" : "?") + "tenant=" + tenantQ : "");
const view = $("#view");

async function boot() {
  ctx = await call(q("/api/admin/context"));
  if (IS_SUPER && ctx.tenants.length) { const sel = $("#tenant-pick"); sel.hidden = false; sel.replaceChildren(...ctx.tenants.map(t => h("option", { value: t.id }, t.name)));
    sel.value = tenantQ || ctx.tenant?.id; sel.onchange = () => { tenantQ = sel.value; uid = null; boot(); }; }
  if (ctx.tenant) { const r = document.body.style; r.setProperty("--teal", ctx.tenant.theme.accent); r.setProperty("--deep", ctx.tenant.theme.dark); }
  $("#biz").textContent = ctx.tenant ? ctx.tenant.name : "CareDesk admin"; $("#vert").textContent = ctx.tenant?.vertical || "";
  const tabs = [["customers", "Customers"], ["knowledge", "Policies & FAQ"]]; if (IS_SUPER) { tabs.unshift(["overview", "All businesses"]); tabs.push(["platform", "Bot contexts"]); if (tabName === "customers" && !tenantQ && !window.__seen) { tabName = "overview"; window.__seen = 1; } }
  const bar = $("#tabs"); bar.replaceChildren(...tabs.map(([k, l]) => h("button", { class: "tab", role: "tab", "aria-selected": k === tabName, onclick: () => { tabName = k; boot(); } }, l)));
  ({ customers, knowledge, platform, overview })[tabName]();
}

// ---------- customers ----------
async function customers() {
  const users = await call(q("/api/admin/users")), list = h("div", { class: "card ulist", style: "padding:0" }), detail = h("div");
  view.replaceChildren(h("div", { class: "split" }, list, detail));
  if (!users.length) list.append(empty("No users in this business yet."));
  users.forEach(u => list.append(h("button", { class: "urow", "aria-current": u.id === uid, onclick: () => { uid = u.id; qDate = ""; customers(); } },
    h("span", { class: "t" }, u.name), u.human && h("span", { class: "chip s-pending" }, "Wants team"), (u.open + u.pending) ? h("span", { class: "badge", title: "Open tickets + pending bookings" }, u.open + u.pending) : null)));
  if (!uid) return detail.append(empty("Choose a user to see their tickets, bookings and questions."));
  const d = await call(q(`/api/admin/users/${uid}`) + (qDate ? "&date=" + qDate : ""));
  const st = ctx.tenant.statuses;
  const sel = (kind, id, cur, opts, note) => { const s = h("select", { "aria-label": "Status" }, opts.map(o => h("option", { value: o, selected: o === cur }, label(o))));
    s.onchange = async () => { await call(q(`/api/admin/status/${kind}/${id}`), "POST", { status: s.value, note: note ? note.value : undefined }); customers(); }; return s; };
  const tickets = d.tickets.length ? h("table", {}, h("thead", {}, h("tr", {}, ...["Ticket", "Requested", "Status", "Team note"].map(x => h("th", {}, x)))),
    h("tbody", {}, d.tickets.map(t => { const note = h("input", { value: t.note, placeholder: "Add note", maxlength: 500, "aria-label": "Note" });
      note.onchange = () => call(q(`/api/admin/status/ticket/${t.id}`), "POST", { status: t.status, note: note.value });
      return h("tr", {}, h("td", {}, h("b", {}, t.subject), h("div", { class: "muted sm" }, t.description)), h("td", {}, t.date), h("td", {}, sel("ticket", t.id, t.status, st.ticket, note)), h("td", {}, note)); }))) : empty("No tickets for this selection.");
  const books = d.bookings.length ? h("table", {}, h("thead", {}, h("tr", {}, ...[ctx.tenant.theme.label, "When", "Status"].map(x => h("th", {}, x)))),
    h("tbody", {}, d.bookings.map(b => h("tr", {}, h("td", {}, b.service, h("div", { class: "muted sm" }, b.notes)), h("td", {}, b.when), h("td", {}, sel("booking", b.id, b.status, st.booking)))))) : empty(`No ${ctx.tenant.theme.noun.toLowerCase()}s for this selection.`);
  const queries = d.queries.length ? d.queries.map(m => h("div", { class: "item" }, h("div", { class: "grow" }, m.text), h("span", { class: "muted sm" }, m.at))) : [empty("No questions for this selection.")];
  const days = h("div", { class: "days" }, h("button", { class: "day", "aria-pressed": !qDate, onclick: () => { qDate = ""; customers(); } }, h("b", {}, "All dates"), h("span", {}, "Everything")),
    Object.keys(d.month).sort().reverse().map(k => { const x = d.month[k]; return h("button", { class: "day", "aria-pressed": qDate === k, onclick: () => { qDate = k; customers(); } }, h("b", {}, fmtDay(k)), h("span", {}, `${x.tickets} tickets, ${x.bookings} ${ctx.tenant.theme.noun.toLowerCase()}s, ${x.queries} questions`)); }));
  const date = h("input", { type: "date", value: qDate, style: "width:auto", "aria-label": "Pick a date" }); date.onchange = () => { qDate = date.value; customers(); };
  // team chat
  const msgs = h("div", { class: "msgs", style: "flex:1" }, d.chat.map(bubble)); const inp = h("input", { placeholder: "Reply as team", maxlength: 2000, "aria-label": "Reply", style: "color:#10212B" });
  const sendR = async () => { if (!inp.value.trim()) return; await call(q("/api/admin/reply"), "POST", { user_id: uid, text: inp.value }); customers(); };
  inp.onkeydown = e => e.key === "Enter" && sendR();
  const flip = h("button", { class: "btn sm", onclick: async () => { await call(q("/api/admin/reply"), "POST", { user_id: uid, action: d.mode === "human" ? "bot" : "human" }); customers(); } }, d.mode === "human" ? "Hand back to bot" : "Take over chat");
  detail.append(h("div", { class: "row wrap" }, h("h2", { class: "grow" }, d.name), h("label", { for: "dd", class: "sm", style: "margin:0" }, "Date"), date, h("span", { class: "muted sm" }, d.email || "")),
    h("div", { style: "margin:12px 0" }, days),
    h("div", { class: "card" }, h("h2", { style: "margin-bottom:8px" }, "Tickets"), tickets),
    h("div", { class: "card", style: "margin-top:12px" }, h("h2", { style: "margin-bottom:8px" }, ctx.tenant.theme.noun + "s"), books),
    h("div", { class: "grid2", style: "margin-top:12px" }, h("div", { class: "card" }, h("h2", { style: "margin-bottom:8px" }, "Questions asked"), queries),
      h("div", { class: "adminchat" }, h("div", { class: "row", style: "padding:10px 12px;border-bottom:1px solid #ffffff22" }, h("h3", { class: "grow" }, "Conversation · " + (d.mode === "human" ? "team" : "bot")), flip), msgs,
        h("div", { class: "composer" }, inp, h("button", { class: "btn pri", onclick: sendR }, "Send")))));
  msgs.scrollTop = msgs.scrollHeight;
}

// ---------- knowledge ----------
async function knowledge() {
  if (!ctx.tenant) return view.replaceChildren(empty("No business selected."));
  const pol = await call(q("/api/admin/policies")), faq = await call(q("/api/admin/faqs"));
  const file = h("input", { type: "file", accept: "application/pdf" }), title = h("input", { placeholder: "Title (optional)", maxlength: 160 }), err = h("p", { class: "err" });
  const up = async () => { if (!file.files[0]) return; const f = new FormData(); f.append("file", file.files[0]); f.append("title", title.value);
    try { await call(q("/api/admin/policies"), "POST", f); knowledge(); } catch (e) { err.textContent = e.message; } };
  const fq = h("input", { placeholder: "Question", maxlength: 240 }), fa = h("textarea", { rows: 3, placeholder: "Answer", maxlength: 2000 }),
    fc = h("select", {}, ["ticket", "booking", "general"].map(c => h("option", {}, c)));
  view.replaceChildren(h("div", { class: "grid2", style: "margin-top:14px" },
    h("div", { class: "card" }, h("h2", {}, "Policy PDFs"), h("p", { class: "muted sm" }, "The bot answers users only from these documents and your FAQs. Users can’t see or change them."),
      h("div", { class: "row wrap" }, file, title, h("button", { class: "btn pri", onclick: up }, "Upload PDF")), err,
      pol.length ? h("table", {}, h("tbody", {}, pol.map(p => h("tr", {}, h("td", {}, p.title, h("div", { class: "muted sm" }, `${p.date} · ${p.chunks} passages`)), h("td", {}, h("button", { class: "btn sm danger", onclick: async () => { await call(q("/api/admin/policies?id=" + p.id), "DELETE"); knowledge(); } }, "Remove")))))) : empty("No policies uploaded yet.")),
    h("div", { class: "card" }, h("h2", {}, "Team FAQ"), h("div", { class: "row" }, fc, fq), fa,
      h("p", {}, h("button", { class: "btn pri", onclick: async () => { await call(q("/api/admin/faqs"), "POST", { category: fc.value, question: fq.value, answer: fa.value }); knowledge(); } }, "Add FAQ")),
      faq.length ? faq.map(f => h("div", { class: "item" }, h("div", { class: "grow" }, h("div", { class: "t" }, f.question), h("div", { class: "meta" }, `${f.category} · solved ${f.solved} · not solved ${f.unsolved}`)),
        h("button", { class: "btn sm danger", onclick: async () => { await call(q("/api/admin/faqs?id=" + f.id), "DELETE"); knowledge(); } }, "Delete"))) : empty("No FAQs yet."))));
}

// ---------- all businesses (super admin) ----------
async function overview() {
  const o = await call("/api/super/overview");
  const open = id => { tenantQ = String(id); tabName = "customers"; uid = null; boot(); };
  view.replaceChildren(h("div", { style: "margin-top:14px" },
    h("div", { class: "card" }, h("h2", {}, "Every business and its admins"), h("p", { class: "muted sm" }, "“View as admin” opens that business exactly as its admin sees it: tickets, bookings, chats, policies, FAQs."),
      o.tenants.length ? h("table", {}, h("thead", {}, h("tr", {}, ...["Business", "Admins", "Users", "Open tickets", "Pending", "Bot couldn’t answer (7d)", "Wants team", ""].map(x => h("th", {}, x)))),
        h("tbody", {}, o.tenants.map(t => h("tr", {}, h("td", {}, h("b", {}, t.name), h("div", { class: "muted sm" }, t.vertical + (t.bot ? "" : " · bot off"))), h("td", {}, t.admins.join(", ") || "None"), h("td", {}, t.users),
          h("td", {}, t.open_tickets), h("td", {}, t.pending_bookings), h("td", {}, t.unanswered), h("td", {}, t.wants_team), h("td", {}, h("button", { class: "btn sm pri", onclick: () => open(t.id) }, "View as admin")))))) : empty("No businesses yet.")),
    h("div", { class: "card", style: "margin-top:14px" }, h("h2", {}, "Recent admin activity"),
      o.log.length ? h("table", {}, h("thead", {}, h("tr", {}, ...["When", "Business", "Who", "What"].map(x => h("th", {}, x)))), h("tbody", {}, o.log.map(l => h("tr", {}, h("td", {}, l.at), h("td", {}, l.business), h("td", {}, l.actor), h("td", {}, l.action))))) : empty("Nothing yet."))));
}

// ---------- platform (super admin) ----------
async function platform() {
  const [vs, ts] = await Promise.all([call("/api/super/verticals"), call("/api/super/tenants")]);
  const rows = ts.map(t => { const v = h("select", {}, h("option", { value: "" }, "None"), vs.map(x => h("option", { value: x.id, selected: x.id === t.vertical }, x.name)));
    const cb = k => h("input", { type: "checkbox", checked: t[k], style: "width:auto", "aria-label": k }); const [a, b, c] = [cb("bot_enabled"), cb("talk_enabled"), cb("human_chat_enabled")];
    return h("tr", {}, h("td", {}, h("b", {}, t.name), h("div", { class: "muted sm" }, t.users + " users")), h("td", {}, v), h("td", {}, a), h("td", {}, b), h("td", {}, c),
      h("td", {}, h("button", { class: "btn sm pri", onclick: async () => { await call("/api/super/tenants", "POST", { id: t.id, vertical: v.value, bot_enabled: a.checked, talk_enabled: b.checked, human_chat_enabled: c.checked }); platform(); } }, "Save"))); });
  const f = { name: h("input", { maxlength: 60 }), system_prompt: h("textarea", { rows: 6 }), greeting: h("input", { maxlength: 240 }), service_label: h("input", { maxlength: 40 }),
    service_options: h("input", { placeholder: "Check-up, Cleaning, ..." }), refusal_text: h("input", { maxlength: 300 }),
    booking_noun: h("input", { maxlength: 30, placeholder: "Appointment or Order" }), quick_prompts: h("input", { placeholder: "Comma separated chat shortcuts" }),
    accent: h("input", { type: "color" }), accent_dark: h("input", { type: "color" }),
    booking_style: h("select", {}, h("option", { value: "appointment" }, "Appointment (date and time)"), h("option", { value: "order" }, "Order (quantity, pickup or delivery)")) };
  const pickV = h("select", {}, h("option", { value: "" }, "New business type"), vs.map(x => h("option", { value: x.id }, x.name)));
  pickV.onchange = () => { const x = vs.find(y => String(y.id) === pickV.value) || {}; for (const k in f) f[k].value = x[k] || (k === "accent" ? "#0b7a75" : k === "accent_dark" ? "#07403e" : k === "booking_style" ? "appointment" : ""); };
  const save = async () => { const body = {}; for (const k in f) body[k] = f[k].value; await call("/api/super/verticals", "POST", body); platform(); };
  view.replaceChildren(h("div", { style: "margin-top:14px" },
    h("div", { class: "card" }, h("h2", {}, "Businesses"), h("p", { class: "muted sm" }, "Choose which bot context each business gets and which features its users may use."),
      h("table", {}, h("thead", {}, h("tr", {}, ...["Business", "Bot context", "Bot", "Talk", "Team chat", ""].map(x => h("th", {}, x)))), h("tbody", {}, rows))),
    h("div", { class: "card", style: "margin-top:14px" }, h("h2", {}, "Bot contexts (dentist, doctor, shopkeeper…)"), pickV,
      h("label", {}, "Name"), f.name, h("label", {}, "Bot instructions"), f.system_prompt, h("label", {}, "Greeting"), f.greeting,
      h("div", { class: "grid2" }, h("div", {}, h("label", {}, "Booking field label"), f.service_label), h("div", {}, h("label", {}, "Booking choices"), f.service_options)),
      h("div", { class: "grid2" }, h("div", {}, h("label", {}, "Booking flow"), f.booking_style), h("div", {}, h("label", {}, "What bookings are called"), f.booking_noun)),
      h("div", { class: "grid2" }, h("div", {}, h("label", {}, "Main colour"), f.accent), h("div", {}, h("label", {}, "Dark colour"), f.accent_dark)),
      h("label", {}, "Chat shortcuts"), f.quick_prompts, h("label", {}, "Reply when a question is off-topic"), f.refusal_text, h("p", {}, h("button", { class: "btn pri", onclick: save }, "Save bot context")))));
}
boot();
