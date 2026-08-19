// GET /api/leads[?format=json][&limit=100]
// Bearer-token-protected viewer for the rankboost-leads D1 database.
// Each lead row shows its top themes at a glance and expands to the full
// theme list (with every keyword variant) for call prep.

import {
  authFailureStatus,
  bearerToken,
  sameValue,
} from "./_security.js";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtVol(v) {
  return Number(v || 0).toLocaleString("en-US");
}

// The exact page that holds the ranking: this is the URL the boost pushes,
// so it needs to be visible on every theme and variant for call prep.
function safeHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function urlLine(u) {
  const href = safeHttpUrl(u);
  if (!href) return "";
  const shown = href.replace(/^https?:\/\//, "");
  return `<div class="kwu"><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(shown)}</a></div>`;
}

function themesCell(raw) {
  let themes = [];
  try { themes = JSON.parse(raw || "[]"); } catch {}
  if (!themes.length) return "<td>—</td>";

  const top = themes
    .slice(0, 3)
    .map(
      (t) =>
        `<div class="th"><b>${esc(t.keyword)}</b> <span>#${esc(t.position)} · ${fmtVol(t.volume)}/mo</span>${urlLine(t.url)}</div>`
    )
    .join("");

  const full = themes
    .map((t) => {
      const variants = (t.variants || [])
        .filter((v) => v.keyword !== t.keyword)
        .map(
          (v) =>
            `<div class="var">${esc(v.keyword)} <span>#${esc(v.position)} · ${fmtVol(v.volume)}/mo</span>${urlLine(v.url)}</div>`
        )
        .join("");
      return `<div class="theme">
        <div class="th"><b>${esc(t.keyword)}</b> <span>#${esc(t.position)} · ${fmtVol(t.volume)}/mo</span>${urlLine(t.url)}</div>
        ${variants}
      </div>`;
    })
    .join("");

  const more = themes.length > 3 ? themes.length - 3 : 0;
  return `<td class="kw">${top}
    <details>
      <summary>${more ? `+${more} more theme${more === 1 ? "" : "s"} · ` : ""}expand all ${themes.length} themes &amp; variants</summary>
      <div class="full">${full}</div>
    </details>
  </td>`;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const key = bearerToken(request);

  if (!env.LEADS_VIEW_KEY || !sameValue(key, env.LEADS_VIEW_KEY)) {
    const status = await authFailureStatus(request, env, "leads-viewer");
    return new Response("Unauthorized", {
      status: status === 429 ? 429 : 401,
      headers: { "WWW-Authenticate": "Bearer", "Cache-Control": "no-store" },
    });
  }
  if (!env.LEADS_DB) {
    return new Response("LEADS_DB not bound", { status: 500 });
  }

  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 500);
  const { results } = await env.LEADS_DB
    .prepare("SELECT * FROM leads ORDER BY id DESC LIMIT ?1")
    .bind(limit)
    .all();

  if (url.searchParams.get("format") === "json") {
    const parsed = results.map((r) => {
      let themes = [];
      try { themes = JSON.parse(r.top_keywords || "[]"); } catch {}
      return { ...r, top_keywords: themes };
    });
    return new Response(JSON.stringify(parsed, null, 2), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const rows = results
    .map((r) => {
      let themeCount = 0;
      try { themeCount = (JSON.parse(r.top_keywords || "[]") || []).length; } catch {}
      return `<tr>
        <td>${r.id}</td>
        <td class="when">${esc(r.created_at)}</td>
        <td><b>${esc(r.name)}</b><div class="sub">${esc(r.phone)}</div>${r.email ? `<div class="sub">${esc(r.email)}</div>` : ""}</td>
        <td><a href="https://${esc(r.domain)}" target="_blank" rel="noopener noreferrer">${esc(r.domain)}</a></td>
        <td class="${r.qualified ? "q" : "nq"}">${r.qualified ? "✓ qualified" : esc(r.status)}
          <div class="sub">${r.total_boost_fits} fits · ${themeCount} themes</div></td>
        ${themesCell(r.top_keywords)}
      </tr>`;
    })
    .join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rank Boost Leads</title>
  <meta name="robots" content="noindex,nofollow">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{font-family:-apple-system,system-ui,sans-serif;background:#0A1628;color:#F8FAFC;padding:2rem;margin:0}
    h1{font-size:1.2rem}
    table{border-collapse:collapse;width:100%;font-size:0.82rem;margin-top:1rem}
    th,td{border:1px solid rgba(148,163,184,0.25);padding:0.55rem 0.65rem;text-align:left;vertical-align:top}
    th{background:#0F1F35;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.06em;color:#94A3B8}
    a{color:#D4B96A}
    .q{color:#34D399;font-weight:600}
    .nq{color:#94A3B8}
    .sub{font-weight:400;color:#94A3B8;font-size:0.72rem;margin-top:0.15rem}
    .when{white-space:nowrap;color:#CBD5E1}
    .kw{min-width:320px}
    .th{margin-bottom:0.3rem;font-size:0.78rem}
    .th b{color:#F8FAFC;font-weight:600}
    .th span,.var span{color:#D4B96A;font-size:0.72rem;margin-left:0.35rem;white-space:nowrap}
    details{margin-top:0.35rem}
    summary{cursor:pointer;color:#94A3B8;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em}
    summary:hover{color:#D4B96A}
    .full{margin-top:0.6rem;border-top:1px dashed rgba(196,163,90,0.35);padding-top:0.6rem}
    .theme{margin-bottom:0.65rem;padding-bottom:0.5rem;border-bottom:1px solid rgba(148,163,184,0.12)}
    .theme:last-child{border-bottom:none}
    .var{color:#94A3B8;font-size:0.72rem;margin:0.12rem 0 0 1rem}
    .kwu{font-size:0.66rem;margin:0.05rem 0 0.2rem}
    .kwu a{color:#64748B;text-decoration:none;word-break:break-all}
    .kwu a:hover{color:#D4B96A;text-decoration:underline}
  </style></head><body>
  <h1>Rank Boost Leads · ${results.length} shown</h1>
  <table><tr><th>ID</th><th>When (UTC)</th><th>Lead</th><th>Domain</th><th>Result</th><th>Themes (click to expand)</th></tr>${rows}</table>
  </body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
  });
}
