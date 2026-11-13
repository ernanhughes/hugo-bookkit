"""Chapter link regression: relref and relative links must not double prefixes.

Regression: `[text]({{< relref "./02-chapter" >}})` rendered as
`/books/book-a/01-chapter//books/book-a/02-chapter/` because the shared
link destination resolver treated Hugo's HAHAHUGOSHORTCODE placeholder as a
relative path and prefixed it with the current page permalink before the
shortcode expanded. The placeholder must pass through untouched.
"""
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ChapterLinksTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.site = Path(cls.temp.name)

        def write(path, body):
            target = cls.site / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(body, encoding="utf-8")

        write(
            "go.mod",
            f"module test.example/chapter-links\n\ngo 1.23.0\n"
            f"require github.com/ernanhughes/hugo-bookkit v0.0.0\n"
            f"replace github.com/ernanhughes/hugo-bookkit => {ROOT.as_posix()}\n",
        )
        write(
            "hugo.toml",
            'baseURL = "https://example.org/library/"\n'
            'title = "Chapter links fixture"\n'
            'disableKinds = ["taxonomy", "term", "rss"]\n'
            "[module]\n"
            "  [[module.imports]]\n"
            '    path = "github.com/ernanhughes/hugo-bookkit"\n'
            "[markup.goldmark.renderer]\n"
            "  unsafe = true\n",
        )
        for book in ("book-a", "book-b"):
            write(f"content/books/{book}/_index.md", f'+++\ntitle = "{book}"\n+++\n')
            # Chapter 1 links to chapter 2 four ways plus a display-math block
            # containing a standalone "=" line (math passthrough tripwire).
            write(
                f"content/books/{book}/01-chapter.md",
                '+++\ntitle = "' + book + ' one"\nweight = 1\n+++\n\n'
                '[Chapter 2:]({{< relref "./02-chapter" >}}) installation.\n\n'
                '[Relative](./02-chapter)\n\n'
                '[Root](/books/' + book + '/02-chapter/)\n\n'
                '[Fragment]({{< relref "./02-chapter" >}}#section)\n\n'
                '$$\n'
                'x\n'
                '=\n'
                '1\n'
                '$$\n\n'
                '## Section\n\nBody.\n',
            )
            write(
                f"content/books/{book}/02-chapter.md",
                '+++\ntitle = "' + book + ' two"\nweight = 2\n+++\n\n'
                '## Section\n\nSecond chapter.\n',
            )
        cls.dest = cls.site / "public"
        run = subprocess.run(
            [os.environ.get("HUGO_BINARY", "hugo"), "--source", str(cls.site), "--destination", str(cls.dest)],
            capture_output=True,
            text=True,
        )
        if run.returncode:
            raise AssertionError(run.stdout + run.stderr)
        cls.pages = {
            p.relative_to(cls.dest).as_posix(): p.read_text(encoding="utf-8")
            for p in cls.dest.rglob("*.html")
        }

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def html(self, book):
        return self.pages[f"books/{book}/01-chapter/index.html"]

    def hrefs_for(self, html, text):
        return re.findall(
            r'<a[^>]*href="([^"]+)"[^>]*>' + re.escape(text) + r"</a>", html
        )

    def test_relref_link_resolves_to_sibling(self):
        for book in ("book-a", "book-b"):
            html = self.html(book)
            hrefs = self.hrefs_for(html, "Chapter 2:")
            self.assertEqual(len(hrefs), 1, book)
            self.assertEqual(hrefs[0], f"/library/books/{book}/02-chapter/", book)

    def test_relative_and_root_and_fragment_links(self):
        for book in ("book-a", "book-b"):
            html = self.html(book)
            self.assertEqual(self.hrefs_for(html, "Relative"), [f"/library/books/{book}/02-chapter/"])
            self.assertEqual(self.hrefs_for(html, "Root"), [f"/library/books/{book}/02-chapter/"])
            self.assertEqual(
                self.hrefs_for(html, "Fragment"),
                [f"/library/books/{book}/02-chapter/#section"],
            )

    def test_no_doubled_book_prefix(self):
        for book in ("book-a", "book-b"):
            html = self.html(book)
            self.assertNotIn("//books/", html)
            self.assertNotIn("/01-chapter//", html)
            self.assertNotIn("/01-chapter/books", html)

    def test_no_cross_book_leak(self):
        html_a = self.html("book-a")
        self.assertNotIn("/books/book-b/02-chapter/", html_a)
        html_b = self.html("book-b")
        self.assertNotIn("/books/book-a/02-chapter/", html_b)

    def test_no_shortcode_placeholders_leak(self):
        for book in ("book-a", "book-b"):
            self.assertNotIn("HAHAHUGOSHORTCODE", self.html(book))
            self.assertNotIn("#ZgotmplZ", self.html(book))


if __name__ == "__main__":
    unittest.main()
