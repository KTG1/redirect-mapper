# Redirect Mapper

An SEO-focused Python tool that maps broken/404 URLs to the most relevant live URL and audits existing redirect chains. It is dependency-free, explainable, and designed to keep uncertain matches in human review.

## Quick start

```bash
python3 url_redirect_mapper.py map examples/404s.csv examples/live-urls.csv -o redirect-map.csv
python3 url_redirect_mapper.py audit examples/live-urls.csv -o redirect-audit.csv
python3 -m unittest discover -v
```

Input CSVs require a `url` column. Add `title` for better relevance; destination files may include `status`. The output includes the total score and its path, slug, token, and title components.

## Scoring and SEO safeguards

- Slug similarity: 38%
- Shared URL/title concepts: 25%
- Full path similarity: 17%
- Page title similarity: 12%
- Directory-depth similarity: 8%
- Small same-host bonus

Scores below the approval threshold are left without a destination. Close alternatives, low-confidence matches, and non-200 destination statuses are marked for review. Always validate intent and traffic value before deploying redirects; fuzzy similarity is decision support, not a substitute for editorial judgment.

## GitHub Pages

The `docs/` directory contains a private, browser-only version of the mapper. Enable **Settings → Pages → Deploy from branch**, select your default branch and `/docs`. CSV data never leaves the browser.

The web interface accepts one complete crawl-export CSV. It recognizes common crawler headers such as `URL`, `Page`, `Address`, or `Internal URL`; `Status Code` or `Response Code`; `Title 1`; `H1-1`; and `Meta Description`. Comma-, semicolon-, and tab-delimited exports are supported, including Excel `sep=` preambles and UTF-16 files. Rows with 404/410 statuses become redirect sources; 2xx rows become eligible destinations. Every broken URL receives its closest live candidate, with low scores flagged for manual review. URL structure is the primary matching signal, supported by title, H1, and description similarity when those columns are present.

Large crawls are processed in non-blocking batches. For datasets with more than 2,000 live URLs, a URL/title token and slug-trigram index shortlists the most relevant candidates before detailed fuzzy scoring. The progress bar reports indexing, matching, and rendering stages; CSV export always contains all suggestions even when the on-page preview is capped at 500 rows.

## Production notes

Prefer a single 301/308 hop directly to a canonical 200 URL. Avoid redirecting every missing page to the home page, soft-404 destinations, loops, and irrelevant matches. Preserve intentionally valuable query parameters and test generated rules in staging.

## License

MIT
