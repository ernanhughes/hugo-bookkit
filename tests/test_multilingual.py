"""Exercise a real importing consumer with partial translations."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class MultilingualTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.site = Path(cls.temp.name)

        def write(path, text):
            target = cls.site / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8")

        write("go.mod", f"module test.example/languages\n\ngo 1.23.0\nrequire github.com/ernanhughes/hugo-bookkit v0.3.0\nreplace github.com/ernanhughes/hugo-bookkit => {ROOT.as_posix()}\n")
        write("hugo.toml", '''baseURL = "https://example.org/"
title = "Library"
defaultContentLanguage = "en"
disableKinds = ["taxonomy", "term", "rss"]
[module]
  [[module.imports]]
    path = "github.com/ernanhughes/hugo-bookkit"
[languages.en]
  label = "English"
  locale = "en-US"
  contentDir = "content"
  weight = 1
[languages.zh-cn]
  label = "简体中文"
  locale = "zh-CN"
  contentDir = "content-zh-cn"
  weight = 2
  hasCJKLanguage = true
  [languages.zh-cn.params.bookkit]
    contentRoot = "content-zh-cn"
''')
        for root, book, chapter in [("content", "Demo book", "English chapter"), ("content-zh-cn", "示例图书", "中文章节")]:
            write(f"{root}/_index.md", '+++\ntitle = "Library"\n+++\n')
            write(f"{root}/books/demo/_index.md", f'+++\ntitle = "{book}"\n+++\n')
            write(f"{root}/books/demo/01-chapter.md", f'+++\ntitle = "{chapter}"\nweight = 1\n+++\nContent.\n')
        write("content/books/demo/02-chapter.md", '+++\ntitle = "English only"\nweight = 2\n+++\n')
        write("content/examples/only-en/01-chapter/index.md", '+++\ntitle = "English-only example"\n+++\n')
        write("content/examples/demo/01-chapter/index.md", '+++\ntitle = "English example"\n+++\n')
        write("content-zh-cn/examples/demo/01-chapter/index.md", '+++\ntitle = "中文示例"\n+++\n')
        cls.dest = cls.site / "public"
        run = subprocess.run([os.environ.get("HUGO_BINARY", "hugo"), "--source", str(cls.site), "--destination", str(cls.dest)], capture_output=True, text=True, encoding="utf-8")
        if run.returncode:
            raise AssertionError(run.stdout + run.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def html(self, path):
        return (self.dest / path / "index.html").read_text(encoding="utf-8")

    def test_translated_chapter_links_and_metadata(self):
        english = self.html("books/demo/01-chapter")
        chinese = self.html("zh-cn/books/demo/01-chapter")
        self.assertIn('href="/zh-cn/books/demo/01-chapter/" lang="zh-cn"', english)
        self.assertIn('href="/books/demo/01-chapter/" lang="en"', chinese)
        self.assertIn('hreflang="zh-cn" href="https://example.org/zh-cn/books/demo/01-chapter/"', english)
        self.assertIn('<html lang="zh-CN">', chinese)
        self.assertIn('rel="canonical" href="https://example.org/zh-cn/books/demo/01-chapter/"', chinese)

    def test_missing_translation_falls_back_to_home(self):
        self.assertIn('href="/zh-cn/" lang="zh-cn"', self.html("books/demo/02-chapter"))
        self.assertFalse((self.dest / "zh-cn/books/demo/02-chapter/index.html").exists())

    def test_chinese_reader_and_language_progress_isolation(self):
        html = self.html("zh-cn/books/demo/01-chapter")
        self.assertIn("第 01 章，共 1 章", html)
        self.assertIn('data-continue-reading="继续阅读"', html)
        self.assertIn('data-storage-prefix="hugo-bookkit:progress:zh-cn:"', html)
        self.assertIn('data-storage-prefix="hugo-bookkit:progress:"', self.html("books/demo/01-chapter"))
        self.assertNotIn('data-chapter-url="/books/', html)

    def test_example_adapter_is_scoped_to_language(self):
        self.assertTrue((self.dest / "examples/only-en/index.html").exists())
        self.assertFalse((self.dest / "zh-cn/examples/only-en/index.html").exists())
        self.assertIn("中文示例", self.html("zh-cn/examples/demo"))
        self.assertNotIn("English example", self.html("zh-cn/examples/demo"))


if __name__ == "__main__":
    unittest.main()
