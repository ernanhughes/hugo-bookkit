"""Bookkit reference previews: fixture-site build tests.

Builds a temporary consumer site (module replace => this repo) with two
books, an allowlisted references section and adversarial cases, then
asserts static link/preview behavior. Interactive hover/focus/Escape/touch
behavior is covered by tests/references.browser.cjs (manual QA: playwright
is unavailable in this environment, so browser assertions are structural).
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
LONG_PREVIEW = " ".join(f"word{n}" for n in range(120))
FEATURES_ON = "\n[params.bookkit.features]\n  references = true\n"
FEATURES_OFF = "\n[params.bookkit.features]\n  references = false\n"


class ReferencesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.site = Path(cls.temp.name)
        write = cls.write
        write("go.mod", "module example.com/bookrefs\n\ngo 1.23.0\nrequire github.com/ernanhughes/hugo-bookkit v0.0.0\nreplace github.com/ernanhughes/hugo-bookkit => %s\n" % ROOT.as_posix())
        write("hugo.toml", """baseURL = "https://example.org/library/"
title = "Reference previews fixture"
disableKinds = ["taxonomy", "term", "rss"]
[module]
  [[module.imports]]
    path = "github.com/ernanhughes/hugo-bookkit"
[markup.goldmark.renderer]
  unsafe = false
[params.bookkit]
  brandLabel = "Fixture"
""")
        write("data/bookkit/references.json", json.dumps({
            "alpha-decision": {"page": "references/decisions/alpha-decision", "kind": "architecture-decision"},
            "beta-note": {"page": "references/notes/beta-note"},
            "draft-doc": {"page": "references/drafts/draft-doc"},
            "long-doc": {"page": "references/notes/long-doc"},
            "missing-doc": {"page": "references/nowhere/missing"},
            "traversal-doc": {"page": "../../secret"},
        }))
        for book in ("alpha", "beta"):
            write(f"content/books/{book}/_index.md", '+++\ntitle = "%s"\n+++\n' % book.title())
        write("content/books/alpha/_index.md", '+++\ntitle = "Alpha"\n+++\n')
        write("content/books/alpha/01-chapter.md", """+++
title = "Alpha one"
weight = 1
+++

See [the alpha decision](ref:alpha-decision) for the rationale.

Details live in [the decision section](ref:alpha-decision#decision).

An [ordinary page](other.md), an [external site](https://example.com/x),
a [missing reference](ref:no-such-id), a [traversal attempt](ref:../../secret)
and a [bad identifier](ref:Bad_ID!) stay plain links.

[Draft reference](ref:draft-doc) is not published yet.
""")
        write("content/books/alpha/other.md", '+++\ntitle = "Other"\nweight = 2\n+++\nOther page.\n')
        write("content/books/beta/01-chapter.md", '+++\ntitle = "Beta one"\nweight = 1\n+++\n\nConsult the [beta note](ref:beta-note) before serving.\n')
        write("content/books/beta/02-chapter.md", '+++\ntitle = "Beta two"\nweight = 2\n+++\n\nThe [long document](ref:long-doc) has more to say.\n')
        write("content/references/decisions/alpha-decision.md", """+++
title = "Alpha Architecture Decision"
status = "Accepted"
preview = "The engine treats a versioned claim as the primary object. Each claim records its domain and assumptions.\\n\\n- record everything\\n- vote on nothing\\n\\nUse `claim-id@1.0.0` fingerprints."
+++

# Alpha Architecture Decision

## Context

<script>alert("injected")</script>

Context paragraph one. Context paragraph two.

## Decision

The engine treats a versioned claim as the primary object.
""")
        write("content/references/notes/beta-note.md", """+++
title = "Beta Serving Note"
+++

# Beta Serving Note

## Serving

Batch requests when the queue is deep:

- keep batches homogeneous
- respect the memory budget

Otherwise serve immediately.
""")
        write("content/references/notes/long-doc.md", '+++\ntitle = "Long Document"\npreview = "%s"\n+++\n\n# Long Document\n\nBody.\n' % LONG_PREVIEW)
        write("content/references/drafts/draft-doc.md", '+++\ntitle = "Draft Document"\ndraft = true\n+++\n\n# Draft Document\n\nNot yet published.\n')
        write("layouts/references/single.html", "<!doctype html><html><body><h1>{{ .Title }}</h1>{{ .Content }}</body></html>")
        write("layouts/references/section.html", "<!doctype html><html><body><h1>{{ .Title }}</h1>{{ range .Pages }}<a href=\"{{ .RelPermalink }}\">{{ .Title }}</a>{{ end }}</body></html>")
        cls.normal, cls.log = cls.build("normal")
        cls.disabled, _ = cls.build("disabled", extra_config=FEATURES_OFF)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    @classmethod
    def write(cls, relpath, body):
        target = cls.site / relpath
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body, encoding="utf-8")

    @classmethod
    def build(cls, name, extra_config=FEATURES_ON):
        if extra_config:
            with (cls.site / "hugo.toml").open("a") as handle:
                handle.write(extra_config)
        try:
            dest = cls.site / name
            run = subprocess.run([os.environ.get("HUGO_BINARY", "hugo"), "--source", str(cls.site), "--destination", str(dest)], capture_output=True, text=True, check=True)
            pages = {p.relative_to(dest).as_posix(): p.read_text(encoding="utf-8") for p in dest.rglob("*") if p.suffix in (".html", ".js", ".css")}
            return pages, run.stdout + run.stderr
        finally:
            if extra_config:
                text = (cls.site / "hugo.toml").read_text(encoding="utf-8")
                (cls.site / "hugo.toml").write_text(text[: -len(extra_config)], encoding="utf-8")

    def test_approved_reference_renders_link_and_preview(self):
        html = self.normal["books/alpha/01-chapter/index.html"]
        self.assertIn('data-bookkit-ref="alpha-decision"', html)
        self.assertIn('href="/library/references/decisions/alpha-decision/"', html)
        self.assertIn("Alpha Architecture Decision", html)
        self.assertIn("architecture-decision", html)
        self.assertIn("Accepted", html)
        self.assertIn("versioned claim as the primary object", html)
        self.assertIn("<ul>", html)
        self.assertIn("<code>claim-id@1.0.0</code>", html)
        self.assertIn("Read the full document", html)

    def test_section_fragment_links_to_section_and_labels_it(self):
        html = self.normal["books/alpha/01-chapter/index.html"]
        self.assertIn('href="/library/references/decisions/alpha-decision/#decision"', html)
        self.assertIn("Section:", html)

    def test_summary_fallback_preview(self):
        html = self.normal["books/beta/01-chapter/index.html"]
        self.assertIn('data-bookkit-ref="beta-note"', html)
        self.assertIn("Batch requests", html)
        self.assertIn("<ul>", html)

    def test_ordinary_and_external_links_unchanged(self):
        html = self.normal["books/alpha/01-chapter/index.html"]
        self.assertIn('href="/library/books/alpha/other/"', html)
        self.assertIn('href="https://example.com/x"', html)
        self.assertNotIn("data-bookkit-ref=\"https", html)

    def test_missing_unknown_and_traversal_ids_degrade(self):
        html = self.normal["books/alpha/01-chapter/index.html"]
        self.assertNotIn('data-bookkit-ref="no-such-id"', html)
        self.assertNotIn("data-bookkit-ref=\"..", html)
        self.assertNotIn('data-bookkit-ref="Bad_ID!"', html)
        self.assertIn("bookkit-ref-unresolved", html)
        self.assertNotIn("#ZgotmplZ", html)
        self.assertIn("ref:no-such-id", self.log)
        self.assertIn("ref:../../secret", self.log)
        self.assertIn("ref:Bad_ID!", self.log)

    def test_no_sanitizer_placeholders_anywhere(self):
        for pages in (self.normal, self.disabled):
            for path, html in pages.items():
                self.assertNotIn("#ZgotmplZ", html, path)

    def test_disabled_feature_renders_verbatim_links(self):
        html = self.disabled["books/alpha/01-chapter/index.html"]
        self.assertIn('href="ref:alpha-decision"', html)
        self.assertIn('href="/library/books/alpha/other/"', html)

    def test_draft_target_is_not_previewed(self):
        html = self.normal["books/alpha/01-chapter/index.html"]
        self.assertNotIn('data-bookkit-ref="draft-doc"', html)

    def test_injected_markup_is_escaped(self):
        html = self.normal["books/alpha/01-chapter/index.html"]
        self.assertNotIn('<script>alert("injected")</script>', html)

    def test_long_preview_warns(self):
        self.assertIn("exceeds 80 words", self.log)

    def test_no_javascript_navigation_and_keyboard_wiring(self):
        html = self.normal["books/alpha/01-chapter/index.html"]
        self.assertIn('aria-describedby="bookkit-ref-alpha-decision-0"', html)
        self.assertIn('aria-expanded="false"', html)
        self.assertIn('aria-controls="bookkit-ref-alpha-decision-0"', html)
        self.assertIn("<button", html)

    def test_js_contains_handlers_without_inner_html(self):
        path = next(p for p in self.normal if p.endswith("js/bookkit-references.js"))
        script = self.normal[path]
        for token in ("Escape", "data-open", "aria-expanded", "getBoundingClientRect"):
            self.assertIn(token, script)
        self.assertNotIn("innerHTML", script)

    def test_disabled_feature_renders_no_previews_or_assets(self):
        html_pages = {p: h for p, h in self.disabled.items() if p.endswith(".html")}
        self.assertTrue(html_pages)
        for path, html in html_pages.items():
            self.assertNotIn("data-bookkit-ref", html)
        joined = "\n".join(self.disabled.values())
        self.assertNotIn("bookkit-references.js", joined)
        self.assertNotIn("bookkit-references.css", joined)

    def test_second_book_uses_feature(self):
        html = self.normal["books/beta/01-chapter/index.html"]
        self.assertIn('data-bookkit-ref="beta-note"', html)
        self.assertIn('href="/library/references/notes/beta-note/"', html)

    def test_full_reference_pages_render(self):
        html = self.normal["references/decisions/alpha-decision/index.html"]
        self.assertIn("Alpha Architecture Decision", html)
        self.assertIn("The engine treats a versioned claim", html)

    def test_deterministic_rebuild(self):
        again, _ = self.build("repeat")
        self.assertEqual(again["books/alpha/01-chapter/index.html"], self.normal["books/alpha/01-chapter/index.html"])

    def test_source_change_updates_preview(self):
        target = self.site / "content/references/notes/beta-note.md"
        original = target.read_text(encoding="utf-8")
        try:
            target.write_text(original.replace("Batch requests", "UNIQUEbatchmarker requests"), encoding="utf-8")
            updated, _ = self.build("updated")
            self.assertIn("UNIQUEbatchmarker", updated["books/beta/01-chapter/index.html"])
        finally:
            target.write_text(original, encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
