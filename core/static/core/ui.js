// Shared helpers. Always build DOM with textContent (never innerHTML) so user text can't inject script.
const CSRF = document.body.dataset.csrf;
const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
async function call(url, method = "GET", body) {
  const o = { method, headers: { "X-CSRFToken": CSRF } };
  if (body instanceof FormData) o.body = body; else if (body) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(body); }
  const r = await fetch(url, o); let j = {};
  try { j = await r.json(); } catch (e) {}
  if (r.status === 401) location.href = "/";
  if (!r.ok) throw new Error(j.error || "Something went wrong");
  return j;
}
const label = s => s.replace("_", " ").replace(/^./, c => c.toUpperCase());
const chip = s => h("span", { class: "chip s-" + s }, label(s));
const fmtDay = d => new Date(d + "T00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const today = () => new Date().toLocaleDateString("en-CA");
function empty(text) { return h("div", { class: "empty" }, text); }
function bubble(m) { return h("div", { class: "m " + m.sender }, m.text, h("small", {}, (m.sender === "bot" ? "Assistant" : m.sender === "team" ? "Care team" : "You") + " · " + m.at)); }
