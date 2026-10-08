"""Read a completed Hugo build and report examples only; never alter source/output."""
import argparse
from collections import Counter
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


class IndexURLParser(HTMLParser):
    """Hugo's minifier may remove attribute quotes; parse HTML rather than guessing."""
    url = None

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name == "data-search-index-url":
                self.url = value


def audit(public, base_path=""):
    def local(url):
        path = urlsplit(url).path
        prefix = "/" + base_path.strip("/") if base_path.strip("/") else ""
        if prefix and path.startswith(prefix + "/"):
            path = path[len(prefix):]
        target = public / path.lstrip("/")
        return target / "index.html" if path.endswith("/") else target
    library = public / "examples/index.html"
    if not library.exists():
        return {"example_pages": 0, "books_with_examples": 0, "index_bytes": 0}
    parser = IndexURLParser()
    parser.feed(library.read_text(encoding="utf-8"))
    if not parser.url:
        raise ValueError(f"No example index URL in {library}; rebuild with Examples v1.")
    index = local(parser.url)
    rows = json.loads(index.read_text(encoding="utf-8"))["records"]
    keys = Counter((row["book"], row["chapter"]) for row in rows)
    urls = Counter(row["url"] for row in rows)
    unexpected = [str(p.relative_to(public)) for p in (public / "examples").rglob("*")
                  if p.is_file() and (p.suffix in (".ts", ".py", ".map", ".ipynb") or p.name in ("package.json", "package-lock.json") or "node_modules" in p.parts)]
    return {
        "example_pages": len(rows), "books_with_examples": len({row["book"] for row in rows}),
        "orphan_examples": [row["url"] for row in rows if not row["chapterUrl"]],
        "duplicate_mappings": [list(key) for key, count in keys.items() if count > 1],
        "duplicate_urls": [url for url, count in urls.items() if count > 1],
        "broken_chapter_references": [row["chapterUrl"] for row in rows if row["chapterUrl"] and not local(row["chapterUrl"]).exists()],
        "broken_example_references": [row["url"] for row in rows if not local(row["url"]).exists()],
        "index_bytes": index.stat().st_size,
        "large_example_pages": [row["url"] for row in rows if local(row["url"]).exists() and local(row["url"]).stat().st_size > 256_000],
        "unexpected_published_assets": unexpected,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("public", type=Path)
    parser.add_argument("--base-path", default="", help="Deployment path, for example /library/")
    args = parser.parse_args()
    report = audit(args.public, args.base_path)
    print(json.dumps(report, indent=2))
    raise SystemExit(any(report.get(key) for key in ("duplicate_mappings", "duplicate_urls", "broken_chapter_references", "broken_example_references", "unexpected_published_assets")))
