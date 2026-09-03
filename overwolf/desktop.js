/* Sightline Scrim Importer — desktop settings/status window. */

const $ = (s) => document.querySelector(s);
let bg = null;
overwolf.windows.getMainWindow && (bg = overwolf.windows.getMainWindow());

/* ---- window chrome ---- */
function winCtl(action) {
  overwolf.windows.getCurrentWindow((r) => {
    if (!r || !r.success) return;
    if (action === "min") overwolf.windows.minimize(r.window.id);
    if (action === "close") overwolf.windows.close(r.window.id);
  });
}
$("#min").onclick = () => winCtl("min");
$("#close").onclick = () => winCtl("close");

/* ---- load settings ---- */
function load() {
  $("#url").value = Store.url;
  $("#key").value = Store.key;
  $("#auto").checked = Store.auto;
  const modes = Store.modes;
  document.querySelectorAll("[data-mode]").forEach((cb) => (cb.checked = modes.includes(cb.dataset.mode)));
  $("#opp").value = Store.opponent;
  renderLog();
  renderQueue();
}

/* ---- save ---- */
$("#save").onclick = () => {
  Store.url = $("#url").value;
  Store.key = $("#key").value;
  $("#url").value = Store.url;
  Store.addLog("info", "Settings saved");
  setConn("");
};
$("#auto").onchange = () => (Store.auto = $("#auto").checked);
document.querySelectorAll("[data-mode]").forEach((cb) => {
  cb.onchange = () => {
    Store.modes = [...document.querySelectorAll("[data-mode]:checked")].map((x) => x.dataset.mode);
  };
});
$("#opp").oninput = () => (Store.opponent = $("#opp").value);

/* ---- actions ---- */
function setConn(state, text) {
  const el = $("#connState");
  el.className = "pill" + (state ? " " + state : "");
  el.textContent = text || "";
}
$("#test").onclick = async () => {
  Store.url = $("#url").value; Store.key = $("#key").value;
  setConn("", "testing…");
  const fn = (bg && bg.testConnection) || testConnectionLocal;
  const r = await fn();
  if (r && r.ok) setConn("good", `connected · ${r.team}` + (r.prefix ? ` · ${r.min}+ "${r.prefix}"` : ""));
  else setConn("bad", (r && r.error) || "failed");
};
$("#rescan").onclick = () => {
  if (bg && bg.rescanLast) bg.rescanLast();
  else Store.addLog("error", "Background not ready — is Valorant running?");
};
$("#clearlog").onclick = () => { Store.clearLog(); renderLog(); };

// fallback if getMainWindow isn't available yet
async function testConnectionLocal() {
  try {
    const res = await fetch(Store.url + "/api/import/ping", { headers: { authorization: "Bearer " + Store.key } });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: d.error || res.status };
    if (d.prefix != null || d.min != null) Store.setFilter(d.prefix, d.min);
    return { ok: true, team: d.team, prefix: d.prefix, min: d.min };
  } catch (e) { return { ok: false, error: e.message }; }
}

/* ---- rendering ---- */
function renderLog() {
  const ul = $("#log");
  const rows = Store.log;
  ul.innerHTML = rows.length
    ? rows.map((r) => `<li>
        <span class="t">${new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        <span class="s ${r.status}">${r.status}</span>
        <span class="m">${escapeHtml(r.text)}</span>
      </li>`).join("")
    : `<li><span class="m" style="color:var(--ink3)">Nothing yet. Start a Valorant custom game — it imports automatically when the match ends.</span></li>`;
}
function renderQueue() {
  const n = Store.queue.length;
  $("#queueState").textContent = n ? `${n} match${n > 1 ? "es" : ""} waiting to send (retrying)` : "";
}
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

window.addEventListener("sl-log", () => { renderLog(); renderQueue(); });
setInterval(() => { renderLog(); renderQueue(); }, 5000);

load();
