#!/usr/bin/env python3
"""SEO-oriented fuzzy redirect mapper and redirect-chain auditor.

Uses only the Python standard library so it can be dropped into any crawl workflow.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, unquote, urljoin, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler


TOKEN_RE = re.compile(r"[a-z0-9]+")
TRACKING_KEYS = {"gclid", "fbclid", "msclkid", "utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term"}


@dataclass(frozen=True)
class Page:
    url: str
    title: str = ""
    status: int | None = None


@dataclass
class Match:
    source_url: str
    destination_url: str
    score: float
    confidence: str
    path_score: float
    slug_score: float
    token_score: float
    title_score: float
    notes: str


@dataclass
class Hop:
    url: str
    status: int | None
    location: str = ""
    error: str = ""


def normalized_parts(url: str) -> tuple[str, str, list[str], set[str]]:
    parsed = urlsplit(url.strip())
    path = unquote(parsed.path).lower().strip("/")
    segments = [s for s in path.split("/") if s]
    slug = segments[-1] if segments else ""
    words = set(TOKEN_RE.findall(" ".join(segments)))
    words.update(v.lower() for k, v in parse_qsl(parsed.query) if k.lower() not in TRACKING_KEYS)
    return parsed.netloc.lower().removeprefix("www."), path, segments, words


def ratio(a: str, b: str) -> float:
    if not a and not b:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a or b else 1.0


def score_pages(source: Page, target: Page) -> tuple[float, dict[str, float]]:
    shost, spath, ssegments, swords = normalized_parts(source.url)
    thost, tpath, tsegments, twords = normalized_parts(target.url)
    slug = ratio(ssegments[-1] if ssegments else "", tsegments[-1] if tsegments else "")
    path = ratio(spath, tpath)
    tokens = jaccard(swords, twords)
    title = ratio(source.title.lower(), target.title.lower()) if source.title and target.title else tokens
    depth = 1.0 - min(abs(len(ssegments) - len(tsegments)) / 4, 1.0)
    host_bonus = 0.03 if shost == thost else 0.0
    total = min(1.0, 0.38 * slug + 0.25 * tokens + 0.17 * path + 0.12 * title + 0.08 * depth + host_bonus)
    return total, {"path": path, "slug": slug, "tokens": tokens, "title": title}


def best_matches(sources: Iterable[Page], targets: list[Page], threshold: float = 0.45) -> list[Match]:
    results: list[Match] = []
    for source in sources:
        candidates = sorted(((score_pages(source, t), t) for t in targets if t.url != source.url), key=lambda x: x[0][0], reverse=True)
        if not candidates:
            results.append(Match(source.url, "", 0, "none", 0, 0, 0, 0, "No destination candidates"))
            continue
        (score, parts), target = candidates[0]
        runner_up = candidates[1][0][0] if len(candidates) > 1 else 0
        confidence = "high" if score >= 0.78 and score - runner_up >= 0.08 else "medium" if score >= 0.60 else "low"
        notes = []
        if score < threshold:
            confidence, target = "review", Page("")
            notes.append("Below approval threshold")
        elif score - runner_up < 0.05:
            notes.append("Close alternative; review manually")
        if target.status and target.status >= 300:
            notes.append(f"Destination status is {target.status}")
        results.append(Match(source.url, target.url, round(score * 100, 1), confidence,
                             round(parts["path"] * 100, 1), round(parts["slug"] * 100, 1),
                             round(parts["tokens"] * 100, 1), round(parts["title"] * 100, 1), "; ".join(notes)))
    return results


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


def audit_chain(url: str, max_hops: int = 10, timeout: float = 10) -> list[Hop]:
    opener = build_opener(NoRedirect)
    seen: set[str] = set()
    hops: list[Hop] = []
    current = url
    for _ in range(max_hops + 1):
        if current in seen:
            hops.append(Hop(current, None, error="Redirect loop detected"))
            break
        seen.add(current)
        try:
            req = Request(current, headers={"User-Agent": "RedirectMapper/1.0 (+SEO audit)"}, method="HEAD")
            try:
                response = opener.open(req, timeout=timeout)
                status, headers = response.status, response.headers
            except HTTPError as exc:
                status, headers = exc.code, exc.headers
            if status in {301, 302, 303, 307, 308}:
                location = urljoin(current, headers.get("Location", ""))
                hops.append(Hop(current, status, location))
                if not location:
                    break
                current = location
            else:
                hops.append(Hop(current, status))
                break
        except (URLError, TimeoutError, ValueError) as exc:
            hops.append(Hop(current, None, error=str(exc)))
            break
    else:
        hops.append(Hop(current, None, error=f"More than {max_hops} redirects"))
    return hops


def load_pages(path: Path) -> list[Page]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = csv.DictReader(handle)
        if not rows.fieldnames or "url" not in {h.lower() for h in rows.fieldnames}:
            raise ValueError(f"{path} must contain a 'url' column")
        keymap = {h.lower(): h for h in rows.fieldnames}
        pages = []
        for row in rows:
            url = row.get(keymap["url"], "").strip()
            if url:
                raw_status = row.get(keymap.get("status", ""), "").strip()
                pages.append(Page(url, row.get(keymap.get("title", ""), "").strip(), int(raw_status) if raw_status.isdigit() else None))
        return pages


def write_csv(path: Path, rows: Iterable[dict]) -> None:
    rows = list(rows)
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)


def command_map(args: argparse.Namespace) -> int:
    matches = best_matches(load_pages(args.sources), load_pages(args.destinations), args.threshold)
    write_csv(args.output, (asdict(m) for m in matches))
    print(f"Wrote {len(matches)} recommendations to {args.output}")
    return 0


def command_audit(args: argparse.Namespace) -> int:
    pages = load_pages(args.input)
    output = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        pending = {pool.submit(audit_chain, p.url, args.max_hops, args.timeout): p.url for p in pages}
        for future in as_completed(pending):
            url = pending[future]
            hops = future.result()
            output.append({"url": url, "final_url": hops[-1].url, "final_status": hops[-1].status or "",
                           "redirect_count": sum(h.status in {301, 302, 303, 307, 308} for h in hops),
                           "has_loop": any("loop" in h.error.lower() for h in hops),
                           "chain": " -> ".join(f"{h.url} [{h.status or h.error}]" for h in hops)})
            time.sleep(args.delay)
    write_csv(args.output, output)
    print(f"Wrote {len(output)} chain audits to {args.output}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Map 404 URLs to relevant destinations and audit redirect chains.")
    sub = parser.add_subparsers(dest="command", required=True)
    mapper = sub.add_parser("map", help="Create fuzzy redirect recommendations")
    mapper.add_argument("sources", type=Path, help="CSV of broken URLs; columns: url, optional title")
    mapper.add_argument("destinations", type=Path, help="CSV of live URLs; columns: url, optional title/status")
    mapper.add_argument("-o", "--output", type=Path, default=Path("redirect-map.csv"))
    mapper.add_argument("--threshold", type=float, default=0.45, help="Minimum 0–1 score for a recommendation")
    mapper.set_defaults(func=command_map)
    audit = sub.add_parser("audit", help="Follow HTTP redirects and report chains/loops")
    audit.add_argument("input", type=Path, help="CSV with a url column")
    audit.add_argument("-o", "--output", type=Path, default=Path("redirect-audit.csv"))
    audit.add_argument("--workers", type=int, default=5)
    audit.add_argument("--max-hops", type=int, default=10)
    audit.add_argument("--timeout", type=float, default=10)
    audit.add_argument("--delay", type=float, default=0)
    audit.set_defaults(func=command_audit)
    return parser


if __name__ == "__main__":
    try:
        parsed_args = build_parser().parse_args()
        sys.exit(parsed_args.func(parsed_args))
    except (ValueError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(2)
