# Multilingual consumers

Bookkit supports Hugo's multilingual content model. Configure the consumer's
languages with `label`, `locale`, `contentDir` and `weight`. Hugo 0.158 or newer
is required. Keep matching relative file paths to associate translated pages.

The shared header includes English/Chinese (or any configured languages) using
each language's label. Links point to corresponding translations when present;
otherwise they point to the destination language's homepage. Custom consumer
headers must call `bookkit/language-switcher.html`, and custom base templates
must call `bookkit/translation-links.html` inside `<head>` to get these features.
Alternate-language links advertise actual translations only.

Book reader/chapter controls and core example actions use `i18n/en.toml` and
`i18n/zh-cn.toml`. Consumers can override strings through their own `i18n` files.
Reader JavaScript receives localized resume messages through data attributes.
English progress keys remain compatible; other languages use a language suffix
so reading one translation does not clear or overwrite the other's progress.

For examples using separate content directories, set `params.bookkit.contentRoot`
for each language whose content root differs from `content`:

```toml
[languages.zh-cn]
  label = "简体中文"
  locale = "zh-CN"
  contentDir = "content-zh-cn"
  hasCJKLanguage = true
  weight = 2
  [languages.zh-cn.params.bookkit]
    contentRoot = "content-zh-cn"
```

The example adapter scans that language's tree and generates only its existing
example sections. Chapters and examples match within the current language by
their source identities. Translate book branch bundles as well as chapters.
For non-default roots or filename-based translations, provide explicit example
section `_index` files or a consumer-owned adapter if needed.

Research dossiers, site tools and specialized example-search UI still require
consumer translation work; core language support does not translate content.
Consumers may disable research and tool hooks in language-specific parameters
until those surfaces are ready. Use `relLangURL` for internal page links and
`relURL` for shared static assets.

Validate with `python -m unittest discover -s tests -p test_multilingual.py`.
The fixture checks language links, canonical/alternate URLs, missing translations,
Chinese chapter controls, isolated progress and language-scoped examples.
