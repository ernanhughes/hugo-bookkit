"""Build actual importing consumers; no site-specific templates or registry."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ExamplesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.site = Path(cls.temp.name)
        def write(path, body):
            target = cls.site / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(body, encoding="utf-8")
        write("go.mod", f'module test.example/examples\n\ngo 1.23.0\nrequire github.com/ernanhughes/hugo-bookkit v0.3.0\nreplace github.com/ernanhughes/hugo-bookkit => {ROOT.as_posix()}\n')
        write("hugo.toml", '''baseURL = "https://example.org/library/"
title = "Reusable library"
disableKinds = ["taxonomy", "term", "rss"]
[module]
  [[module.imports]]
    path = "github.com/ernanhughes/hugo-bookkit"
[markup.goldmark.renderer]
  unsafe = false
''')
        for book in ("alpha", "beta", "empty"):
            write(f"content/books/{book}/_index.md", f'+++\ntitle = "{book.title()}"\n+++\n')
        write("content/books/alpha/01-chapter.md", '+++\ntitle = "Changed chapter title"\nslug = "renamed"\nweight = 1\n+++\nOrdinary prose.\n')
        write("content/books/alpha/02-chapter.md", '+++\ntitle = "No example"\nweight = 2\n+++\n')
        write("content/books/alpha/03-chapter.md", '+++\ntitle = "Draft example parent"\nweight = 3\n+++\n')
        write("content/books/beta/01-chapter/index.md", '+++\ntitle = "Leaf chapter"\nweight = 1\n+++\n')
        write("content/books/empty/01-chapter.md", '+++\ntitle = "Empty book chapter"\nweight = 1\n+++\n')
        body = '\n# Mechanism\n\n**Formatted Markdown** and bounded evidence.\n\n'
        for language, code in (("typescript", 'const markup = "</textarea><script>throw Error(\'injected\')</script>";\nconsole.log("needle_identifier")'), ("json", '{"value": 1}'), ("bash", "echo '$HOME'"), ("python", "print(42)")):
            body += f"```{language}\n{code}\n```\n\n"
        body += '<script>alert("unsafe")</script>\n'
        body += '\n[Leaf resource](note.txt)\n\n[Other example](../../../examples/beta/01-chapter/)\n'
        write("content/examples/alpha/01-chapter/index.md", '+++\ntitle = "Alpha example"\ndescription = "Alpha description"\ntags = ["needle_identifier"]\n+++\n' + body)
        write("content/examples/alpha/01-chapter/note.txt", "Supporting resource, not a registry.")
        write("content/examples/beta/01-chapter/index.md", '+++\ntitle = "Beta example"\n+++\nBeta implementation.\n')
        write("content/examples/alpha/03-chapter/index.md", '+++\ntitle = "Draft example"\ndraft = true\n+++\nDraft implementation.\n')
        write("content/examples/alpha/99-chapter/index.md", '+++\ntitle = "Orphan example"\n+++\nOrphan implementation.\n')
        # Render the shared context through an ordinary consumer's existing hook.
        write("layouts/partials/fixture-actions.html", '{{ range slice "understand" "apply" }}<textarea data-fixture-prompt>{{ partial "bookkit/examples/prompt-context.html" (dict "page" $.page "action" .) }}</textarea>{{ end }}')
        with (cls.site / "hugo.toml").open("a") as f:
            f.write('\n[params.bookkit]\nchapterActionsPartial = "fixture-actions.html"\n')
        cls.normal, cls.log = cls.build("normal")
        cls.drafts, _ = cls.build("drafts", "--buildDrafts")
        if os.environ.get("BOOKKIT_QA_DIR"):
            shutil.copytree(cls.site / "normal", Path(os.environ["BOOKKIT_QA_DIR"]) / "library", dirs_exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    @classmethod
    def build(cls, name, *flags):
        dest = cls.site / name
        run = subprocess.run([os.environ.get("HUGO_BINARY", "hugo"), "--source", str(cls.site), "--destination", str(dest), *flags], capture_output=True, text=True, check=True)
        return {p.relative_to(dest).as_posix(): p.read_text(encoding="utf-8") for p in dest.rglob("*") if p.suffix in (".html", ".json")}, run.stdout + run.stderr

    def test_discovery_uses_source_not_title_or_slug(self):
        html = self.normal["books/alpha/renamed/index.html"]
        self.assertIn("data-bookkit-example", html)
        self.assertIn("Alpha example", html)
        self.assertNotIn("Beta implementation", html)
        self.assertIn("Beta implementation", self.normal["books/beta/01-chapter/index.html"])
        self.assertNotIn("data-bookkit-example", self.normal["books/alpha/02-chapter/index.html"])

    def test_automatic_library_navigation_and_deployment_prefix(self):
        for path in ("examples/index.html", "examples/alpha/index.html", "examples/beta/index.html"):
            self.assertIn("Search examples", self.normal[path])
        self.assertIn('href="/library/examples/alpha/"', self.normal["books/alpha/index.html"])
        self.assertIn("Browse Examples", self.normal["books/alpha/index.html"])
        self.assertNotIn("Browse Examples", self.normal["books/empty/index.html"])
        self.assertIn('href="/library/books/alpha/renamed/"', self.normal["examples/alpha/01-chapter/index.html"])
        for path in ("examples/alpha/01-chapter/index.html", "books/alpha/renamed/index.html"):
            self.assertIn('href="/library/examples/alpha/01-chapter/note.txt"', self.normal[path])

    def test_orphan_reported_without_false_chapter_link(self):
        self.assertIn("Orphan example", self.log)
        html = self.normal["examples/alpha/99-chapter/index.html"]
        self.assertNotIn("Back to chapter:", html)
        self.assertNotIn("Example AI prompts", html)
        self.assertIn("Orphan example", self.normal["examples/index.html"])

    def test_draft_eligibility_follows_build_mode(self):
        self.assertNotIn("examples/alpha/03-chapter/index.html", self.normal)
        self.assertNotIn("data-bookkit-example", self.normal["books/alpha/03-chapter/index.html"])
        self.assertIn("data-bookkit-example", self.drafts["books/alpha/03-chapter/index.html"])

    def test_formatted_code_exact_sources_and_safe_rendering(self):
        html = self.normal["examples/alpha/01-chapter/index.html"]
        self.assertIn("<strong>Formatted Markdown</strong>", html)
        self.assertEqual(html.count("data-example-copy hidden"), 4)
        self.assertIn("needle_identifier", html)
        self.assertIn("echo &#39;$HOME&#39;", html)
        self.assertNotIn('<script>alert("unsafe")</script>', html)
        self.assertIn('data-example-close hidden', self.normal["books/alpha/renamed/index.html"])

    def test_compact_shared_search_records_and_parent_metadata(self):
        indexes = [json.loads(body) for path, body in self.normal.items() if path.startswith("search/examples-all.")]
        self.assertEqual(len(indexes), 1)
        rows = indexes[0]["records"]
        self.assertEqual(len(rows), 3)
        alpha = next(row for row in rows if row["title"] == "Alpha example")
        self.assertEqual(alpha["type"], "Example")
        self.assertEqual(alpha["chapterUrl"], "/library/books/alpha/renamed/")
        self.assertIn("needle_identifier", alpha["terms"])
        self.assertLessEqual(len(alpha["terms"]), 120)
        self.assertNotIn("html", alpha)
        self.assertNotIn("content", alpha)

    def test_ai_context_and_no_example_fallback(self):
        html = self.normal["books/alpha/renamed/index.html"]
        self.assertIn("https://example.org/library/examples/alpha/01-chapter/", html)
        self.assertIn("https://example.org/library/books/alpha/renamed/", html)
        self.assertIn("Help me adapt", html)
        self.assertIn("especially localhost", html)
        self.assertNotIn("Canonical example context", self.normal["books/alpha/02-chapter/index.html"])

    def test_large_prompt_omits_whole_source_instead_of_partial_code(self):
        target = self.site / "content/examples/alpha/01-chapter/index.md"
        original = target.read_text(encoding="utf-8")
        try:
            target.write_text(original + "\n" + "UNIQUE_OVERSIZE_SOURCE " * 800, encoding="utf-8")
            output, _ = self.build("large")
            html = output["books/alpha/renamed/index.html"]
            prompts = re.findall(r'<textarea data-fixture-prompt>(.*?)</textarea>', html, re.S)
            self.assertEqual(len(prompts), 2)
            for prompt in prompts:
                self.assertIn("omitted in full", prompt)
                self.assertNotIn("UNIQUE_OVERSIZE_SOURCE", prompt)
                self.assertLess(len(prompt), 2000)
        finally:
            target.write_text(original, encoding="utf-8")

    def test_duplicate_identity_is_rejected(self):
        target = self.site / "content/examples/beta/duplicate/01-chapter/index.md"
        target.parent.mkdir(parents=True)
        target.write_text('+++\ntitle = "Duplicate beta chapter"\n+++\n', encoding="utf-8")
        try:
            with self.assertRaises(subprocess.CalledProcessError) as error:
                self.build("duplicate")
            self.assertIn("Duplicate example mapping", error.exception.stdout + error.exception.stderr)
        finally:
            target.unlink()

    def test_index_budget_and_pagination_with_many_examples(self):
        targets = []
        try:
            for number in range(100):
                target = self.site / f"content/examples/growth/{number:03}/index.md"
                target.parent.mkdir(parents=True)
                target.write_text(f'+++\ntitle = "Growth {number}"\n+++\n' + " ".join(f"term{x}" for x in range(400)), encoding="utf-8")
                targets.append(target)
            output, _ = self.build("growth")
            index = next(json.loads(body) for path, body in output.items() if path.startswith("search/examples-all."))
            self.assertEqual(len(index["records"]), 103)
            self.assertTrue(all(len(row["terms"]) <= 120 for row in index["records"]))
            self.assertTrue(all(len(term) <= 64 for row in index["records"] for term in row["terms"]))
            self.assertTrue(all(len(row["description"]) <= 200 for row in index["records"]))
            self.assertIn("examples/page/2/index.html", output)
            self.assertLess(len(output["examples/index.html"]), 40_000)
        finally:
            for target in targets:
                target.unlink()


if __name__ == "__main__":
    unittest.main()
