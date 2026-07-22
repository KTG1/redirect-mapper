const $ = (id) => document.getElementById(id);
let crawl = { sources: [], targets: [], all: [], ignored: 0, columns: [] };
let latest = [];

const ALIASES = {
  url: ["url", "address", "page", "page url", "page_url", "landing page", "source url", "source_url", "original url", "internal url", "uri"],
  status: ["status", "status code", "status_code", "http status", "http status code", "response", "response code", "response_code", "http code", "statuscode"],
  title: ["title", "title 1", "title tag", "page title", "meta title"],
  h1: ["h1", "h1-1", "h1 1", "heading 1"],
  description: ["meta description", "description", "meta description 1"],
};

function normalizeHeader(value) { return value.replace(/^\ufeff/, "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " "); }
function columnIndex(headers, name) {
  const aliases = ALIASES[name].map(normalizeHeader);
  const exact = headers.findIndex(header => aliases.includes(header));
  if (exact >= 0) return exact;
  if (name === "url") return headers.findIndex(header => /(^|\s)(url|uri|address)(\s|$)/.test(header));
  if (name === "status") return headers.findIndex(header => /(^|\s)(status|response)(\s|$)/.test(header));
  if (name === "title") return headers.findIndex(header => /(^|\s)title(\s|$)/.test(header));
  if (name === "h1") return headers.findIndex(header => /^h\s*1(?:\s|$)/.test(header));
  if (name === "description") return headers.findIndex(header => /(^|\s)description(\s|$)/.test(header));
  return -1;
}
function detectDelimiter(text) {
  const declared = text.match(/^\ufeff?sep=(.)\r?\n/i);
  if (declared) return declared[1];
  const counts = { ",": 0, ";": 0, "\t": 0 };
  for (const line of text.split(/\r?\n/).filter(Boolean).slice(0, 10)) {
    const lineCounts = { ",": 0, ";": 0, "\t": 0 }; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"' && line[i + 1] === '"') i++;
      else if (line[i] === '"') quoted = !quoted;
      else if (!quoted && Object.prototype.hasOwnProperty.call(lineCounts, line[i])) lineCounts[line[i]]++;
    }
    Object.keys(counts).forEach(delimiter => { counts[delimiter] = Math.max(counts[delimiter], lineCounts[delimiter]); });
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}
function csvRows(text) {
  const delimiter = detectDelimiter(text);
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else if (char !== "\r") cell += char;
  }
  if (cell || row.length) { row.push(cell); if (row.some(Boolean)) rows.push(row); }
  return rows;
}
function parseCrawl(text) {
  const rows = csvRows(text);
  if (rows.length < 2) throw new Error("The CSV has no data rows.");
  const headerRow = rows.slice(0, 20).findIndex(row => {
    const candidate = row.map(normalizeHeader);
    return columnIndex(candidate, "url") >= 0 && columnIndex(candidate, "status") >= 0;
  });
  const fallbackHeaders = rows[0].map(normalizeHeader).filter(Boolean);
  if (headerRow < 0) throw new Error(`Could not identify URL and status columns. Found: ${fallbackHeaders.slice(0, 6).join(", ") || "no headers"}.`);
  const headers = rows[headerRow].map(normalizeHeader);
  const indexes = Object.fromEntries(Object.keys(ALIASES).map(name => [name, columnIndex(headers, name)]));
  const pages = rows.slice(headerRow + 1).map(columns => ({
    url: (columns[indexes.url] || "").trim(),
    status: Number.parseInt(((columns[indexes.status] || "").match(/\b[1-5]\d\d\b/) || [""])[0], 10),
    title: indexes.title >= 0 ? (columns[indexes.title] || "").trim() : "",
    h1: indexes.h1 >= 0 ? (columns[indexes.h1] || "").trim() : "",
    description: indexes.description >= 0 ? (columns[indexes.description] || "").trim() : "",
  })).filter(page => /^https?:\/\//i.test(page.url) && Number.isFinite(page.status));
  const unique = [...new Map(pages.map(page => [page.url, page])).values()];
  const sources = unique.filter(page => page.status === 404 || page.status === 410);
  const targets = unique.filter(page => page.status >= 200 && page.status < 300);
  if (!sources.length) throw new Error("No 404 or 410 rows were found.");
  if (!targets.length) throw new Error("No 2xx destination rows were found.");
  return { sources, targets, all: unique, ignored: unique.length - sources.length - targets.length, columns: Object.entries(indexes).filter(([, index]) => index >= 0).map(([name]) => name) };
}
async function decodeCsvFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  const sample = bytes.slice(0, 200);
  const evenNulls = sample.filter((byte, index) => index % 2 === 0 && byte === 0).length;
  const oddNulls = sample.filter((byte, index) => index % 2 === 1 && byte === 0).length;
  if (oddNulls > sample.length / 8) return new TextDecoder("utf-16le").decode(bytes);
  if (evenNulls > sample.length / 8) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}
function words(value) { return new Set((value.toLowerCase().match(/[a-z0-9]+/g) || []).filter(word => word.length > 1)); }
function parts(page) {
  const parsed = new URL(page.url), path = decodeURIComponent(parsed.pathname).toLowerCase().replace(/^\/+|\/+$/g, "");
  const segments = path.split("/").filter(Boolean);
  return { host: parsed.hostname.replace(/^www\./, ""), path, segments, tokens: words(segments.join(" ")) };
}
function similarity(a, b) {
  a = a.toLowerCase().trim(); b = b.toLowerCase().trim();
  if (!a || !b) return 0;
  const rows = Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) { let previous = rows[0]; rows[0] = i; for (let j = 1; j <= b.length; j++) { const old = rows[j]; rows[j] = Math.min(rows[j] + 1, rows[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = old; } }
  return 1 - rows[b.length] / Math.max(a.length, b.length, 1);
}
function overlap(a, b) { const union = new Set([...a, ...b]); return union.size ? [...a].filter(item => b.has(item)).length / union.size : 0; }
function pageScore(source, target) {
  const a = parts(source), b = parts(target);
  const signals = {
    slug: similarity(a.segments.at(-1) || "", b.segments.at(-1) || ""),
    url_tokens: overlap(a.tokens, b.tokens),
    path: similarity(a.path, b.path),
    title: similarity(source.title, target.title),
    h1: similarity(source.h1, target.h1),
    description: overlap(words(source.description), words(target.description)),
  };
  const metadataAvailable = ["title", "h1", "description"].filter(name => source[name] && target[name]);
  const weights = { slug: .30, url_tokens: .22, path: .15, title: .20, h1: .08, description: .05 };
  let usedWeight = weights.slug + weights.url_tokens + weights.path;
  metadataAvailable.forEach(name => { usedWeight += weights[name]; });
  let total = weights.slug * signals.slug + weights.url_tokens * signals.url_tokens + weights.path * signals.path;
  metadataAvailable.forEach(name => { total += weights[name] * signals[name]; });
  total = total / usedWeight + (a.host === b.host ? .03 : 0);
  const labels = { slug: "URL slug", url_tokens: "URL topics", path: "URL path", title: "Title tag", h1: "H1", description: "Meta description" };
  const strongest = Object.entries(signals).filter(([name]) => !["title", "h1", "description"].includes(name) || metadataAvailable.includes(name)).sort((x, y) => y[1] - x[1])[0];
  return { score: Math.min(1, total), strongest: `${labels[strongest[0]]} ${Math.round(strongest[1] * 100)}%` };
}
function escapeHtml(value) { const element = document.createElement("span"); element.textContent = value; return element.innerHTML; }
function csvCell(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function renderSummary(fileName) {
  $("row-count").textContent = crawl.all.length;
  $("source-count").textContent = crawl.sources.length; $("target-count").textContent = crawl.targets.length;
  $("ignored-count").textContent = crawl.ignored;
  $("signal-count").textContent = crawl.columns.filter(column => ["title", "h1", "description"].includes(column)).length;
  $("crawl-summary").hidden = false; $("crawl-file-status").textContent = `${fileName} · ${crawl.all.length} valid URL rows read`;
  $("crawl-file-status").className = "crawl-status loaded";
}
async function importCrawl(file) {
  if (!file) return;
  try { crawl = parseCrawl(await decodeCsvFile(file)); renderSummary(file.name); $("message").textContent = ""; }
  catch (error) { crawl = { sources: [], targets: [], all: [], ignored: 0, columns: [] }; $("crawl-summary").hidden = true; $("crawl-file-status").textContent = error.message; $("crawl-file-status").className = "crawl-status error"; $("crawl-file").value = ""; }
}
function mapPages() {
  if (!crawl.sources.length || !crawl.targets.length) { $("message").textContent = "Upload a crawl CSV before creating suggestions."; return; }
  const minimum = Number($("threshold").value);
  latest = crawl.sources.map(source => {
    const ranked = crawl.targets.map(target => ({ target, ...pageScore(source, target) })).sort((a, b) => b.score - a.score);
    const best = ranked[0], gap = best.score - (ranked[1]?.score || 0), score = Math.round(best.score * 1000) / 10;
    const confidence = score < minimum ? "review" : score >= 78 && gap >= .08 ? "high" : score >= 60 ? "medium" : "low";
    return { source_url: source.url, source_status: source.status, destination_url: best.target.url, destination_status: best.target.status, score, strongest_signal: best.strongest, confidence };
  });
  $("results").innerHTML = latest.map(item => `<tr><td>${escapeHtml(item.source_url)}</td><td>${escapeHtml(item.destination_url) || "—"}</td><td class="score">${item.score}%</td><td>${escapeHtml(item.strongest_signal)}</td><td><span class="badge ${item.confidence}">${item.confidence}</span></td></tr>`).join("");
  $("message").textContent = ""; $("results-section").hidden = false; $("results-section").scrollIntoView({ behavior: "smooth" });
}

$("threshold").addEventListener("input", event => $("threshold-value").value = event.target.value);
$("crawl-file").addEventListener("change", event => importCrawl(event.target.files[0]));
$("map").addEventListener("click", mapPages);
$("example").addEventListener("click", () => { crawl = parseCrawl("URL,Status Code,Title 1,H1-1,Meta Description\nhttps://example.com/old/technical-seo-checklist,404,Technical SEO Checklist,Technical SEO Checklist,Audit your technical SEO\nhttps://example.com/products/blue-running-shoes,404,Blue Running Shoes,Blue Running Shoes,Lightweight shoes for runners\nhttps://example.com/resources/technical-seo-audit-checklist,200,Technical SEO Audit Checklist,Technical SEO Checklist,A complete technical audit guide\nhttps://example.com/products/mens-blue-running-shoe,200,Men's Blue Running Shoe,Blue Running Shoe,Lightweight blue shoes for runners"); renderSummary("example-crawl.csv"); mapPages(); });
$("download").addEventListener("click", () => { const columns = ["source_url", "source_status", "destination_url", "destination_status", "score", "strongest_signal", "confidence"]; const body = latest.map(item => columns.map(column => csvCell(item[column])).join(",")).join("\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([columns.join(",") + "\n" + body], { type: "text/csv" })); link.download = "redirect-map.csv"; link.click(); URL.revokeObjectURL(link.href); });
