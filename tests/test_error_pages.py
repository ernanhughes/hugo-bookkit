"""Verify error layouts through a real importing consumer, including subpaths."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ErrorPagesTest(unittest.TestCase):
    def test_errors_are_rendered_without_entering_catalogues(self):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            content = temp / "content"
            book = content / "books" / "demo-book"
            book.mkdir(parents=True)
            (content / "_index.md").write_text('---\ntitle: Home\n---\n', encoding="utf-8")
            (content / "books" / "_index.md").write_text('---\ntitle: Books\n---\n', encoding="utf-8")
            (book / "_index.md").write_text('---\ntitle: Demo book\n---\n', encoding="utf-8")
            (book / "01-chapter.md").write_text('---\ntitle: First chapter\n---\nText.\n', encoding="utf-8")
            errors = content / "errors"
            errors.mkdir()
            (errors / "_index.md").write_text(
                '---\ntitle: Errors\nbuild:\n  list: never\n  render: never\n---\n', encoding="utf-8")
            for code in range(500, 506):
                extra = "error_message: '<script>example</script>'\n" if code == 503 else ""
                (errors / f"{code}.md").write_text(
                    f'---\ntitle: Error {code}\ntype: bookkit-error\nerror_code: {code}\n'
                    f'url: /{code}.html\noutputs: [HTML]\n{extra}'
                    'build:\n  list: never\n  render: always\n---\n', encoding="utf-8")
            override = temp / "errors.toml"
            override.write_text(
                'baseURL = "https://example.org/library/"\n'
                f'contentDir = {json.dumps(content.as_posix())}\n', encoding="utf-8")
            destination = temp / "public"
            subprocess.run(
                [os.environ.get("HUGO_BINARY", "hugo"), "--source", "exampleSite",
                 "--config", f'{ROOT / "exampleSite/hugo.toml"},{override}',
                 "--destination", str(destination), "--panicOnWarning"],
                cwd=ROOT, check=True, capture_output=True, text=True)
            for code in (404, *range(500, 506)):
                with self.subTest(code=code):
                    html = (destination / f"{code}.html").read_text(encoding="utf-8")
                    self.assertIn(f'data-bookkit-error="{code}"', html)
                    self.assertIn('name="robots" content="noindex, follow"', html)
                    self.assertIn('href="/library/css/bookkit-errors.css"', html)
                    self.assertIn('href="/library/"', html)
                    self.assertIn('href="/library/books/"', html)
                    self.assertNotIn('Search the site', html)
                    self.assertEqual(html.count('<h1 '), 1)
            maintenance = (destination / "503.html").read_text(encoding="utf-8")
            self.assertIn('&lt;script&gt;example&lt;/script&gt;', maintenance)
            self.assertNotIn('<script>example</script>', maintenance)
            sitemap = (destination / "sitemap.xml").read_text(encoding="utf-8")
            for code in range(500, 506):
                self.assertNotIn(f'/{code}.html', sitemap)
            self.assertFalse((destination / "errors" / "index.html").exists())


if __name__ == "__main__":
    unittest.main()
