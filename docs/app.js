const $ = (id) => document.getElementById(id);
let latest = [];

function urls(value) {
  return [...new Set(value.split(/\r?\n/).map(line => {
    const first = line.split(",")[0].trim().replace(/^"|"$/g, "");
    return /^https?:\/\//i.test(first) ? first : "";
  }).filter(Boolean))];
}
function parts(raw) {
  const u = new URL(raw), path = decodeURIComponent(u.pathname).toLowerCase().replace(/^\/+|\/+$/g, "");
  const segments = path.split("/").filter(Boolean), tokens = new Set((segments.join(" ").match(/[a-z0-9]+/g) || []));
  return {host:u.hostname.replace(/^www\./,""), path, segments, tokens};
}
function similarity(a,b) {
  if (!a && !b) return 1; const rows = Array(b.length + 1).fill(0).map((_,i)=>i);
  for(let i=1;i<=a.length;i++){let prev=rows[0];rows[0]=i;for(let j=1;j<=b.length;j++){const old=rows[j];rows[j]=Math.min(rows[j]+1,rows[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=old;}}
  return 1 - rows[b.length] / Math.max(a.length,b.length,1);
}
function overlap(a,b){const union=new Set([...a,...b]);return union.size ? [...a].filter(x=>b.has(x)).length/union.size : 1}
function score(source,target){const a=parts(source),b=parts(target);const slug=similarity(a.segments.at(-1)||"",b.segments.at(-1)||"");const token=overlap(a.tokens,b.tokens);const path=similarity(a.path,b.path);const depth=1-Math.min(Math.abs(a.segments.length-b.segments.length)/4,1);return Math.min(1,.43*slug+.28*token+.19*path+.1*depth+(a.host===b.host ? .03 : 0));}
function csvCell(value){return `"${String(value).replaceAll('"','""')}"`}
function mapUrls(){const source=urls($("sources").value),targets=urls($("targets").value),min=Number($("threshold").value);if(!source.length||!targets.length){$("message").textContent="Add at least one broken URL and one live destination.";return}$("message").textContent="";latest=source.map(url=>{const ranked=targets.filter(t=>t!==url).map(t=>({url:t,score:score(url,t)})).sort((a,b)=>b.score-a.score);const best=ranked[0]||{url:"",score:0},gap=best.score-(ranked[1]?.score||0);const value=Math.round(best.score*1000)/10;let decision=value<min?"review":value>=78&&gap>=.08?"high":value>=60?"medium":"low";return{source_url:url,destination_url:decision==="review"?"":best.url,score:value,confidence:decision}});$("results").innerHTML=latest.map(x=>`<tr><td>${escapeHtml(x.source_url)}</td><td>${escapeHtml(x.destination_url)||"—"}</td><td class="score">${x.score}%</td><td><span class="badge ${x.confidence}">${x.confidence}</span></td></tr>`).join("");$("results-section").hidden=false;$("results-section").scrollIntoView({behavior:"smooth"});}
function escapeHtml(s){const el=document.createElement("span");el.textContent=s;return el.innerHTML}
$("threshold").addEventListener("input",e=>$("threshold-value").value=e.target.value);
$("map").addEventListener("click",mapUrls);
$("example").addEventListener("click",()=>{$("sources").value="https://example.com/blog/technical-seo-checklist\nhttps://example.com/products/blue-running-shoes\nhttps://example.com/services/seo-audit";$("targets").value="https://example.com/resources/technical-seo-audit-checklist\nhttps://example.com/products/mens-blue-running-shoe\nhttps://example.com/services/technical-seo-audits";mapUrls()});
$("download").addEventListener("click",()=>{const head="source_url,destination_url,score,confidence\n",body=latest.map(x=>[x.source_url,x.destination_url,x.score,x.confidence].map(csvCell).join(",")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([head+body],{type:"text/csv"}));a.download="redirect-map.csv";a.click();URL.revokeObjectURL(a.href)});
