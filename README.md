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

## Production notes

Prefer a single 301/308 hop directly to a canonical 200 URL. Avoid redirecting every missing page to the home page, soft-404 destinations, loops, and irrelevant matches. Preserve intentionally valuable query parameters and test generated rules in staging.

## License

MIT
