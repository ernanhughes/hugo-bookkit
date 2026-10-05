"""Exercise the extension through a real importing Hugo consumer, without dependencies."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ChapterActionsTest(unittest.TestCase):
    def build(self, hook=None):
        with tempfile.TemporaryDirectory() as temp:
            temp = Path(temp)
            config = [str(ROOT / "exampleSite/hugo.toml")]
            if hook is not None:
                override = temp / "actions.toml"
                override.write_text(
                    f'[params.bookkit]\nchapterActionsPartial = "{hook}"\n', encoding="utf-8"
                )
                config.append(str(override))
            subprocess.run(
                [os.environ.get("HUGO_BINARY", "hugo"), "--source", "exampleSite",
                 "--config", ",".join(config), "--destination", str(temp / "public"),
                 "--minify", "--panicOnWarning"],
                cwd=ROOT, check=True, capture_output=True, text=True,
            )
            return {str(p.relative_to(temp / "public")): p.read_text(encoding="utf-8")
                    for p in (temp / "public").rglob("*.html")}

    def test_consumer_hook_and_noop_compatibility(self):
        baseline = self.build()
        for hook in ("fixture-missing-actions.html", "fixture-empty-actions.html"):
            with self.subTest(hook=hook):
                self.assertEqual(baseline, self.build(hook))
        enabled = self.build("fixture-chapter-actions.html")
        chapters = [html for html in enabled.values() if "bookkit-reader--chapter" in html]
        self.assertGreater(len(chapters), 0)
        for html in chapters:
            self.assertEqual(html.count("data-action-fixture"), 1)
            self.assertEqual(html.count("bookkit-reader__actions"), 1)
            self.assertIn("data-book=demo-book", html)
            self.assertIn("data-chapter=", html)
            self.assertIn("Tools for", html)
            self.assertEqual(html.count('aria-label="Previous and next chapter"'), 1)
        for html in enabled.values():
            if "bookkit-reader--chapter" not in html:
                self.assertNotIn("data-action-fixture", html)


if __name__ == "__main__":
    unittest.main()
