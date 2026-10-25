# Frozen Bookkit v0.4.2 local-data runtime

These six files are copied from tag `v0.4.2` and are used only by
`tests/upgrade-v0.4.2.browser.cjs`.

They let the test create a real v1 IndexedDB database with the released runtime,
then migrate it to schema v2 with the current implementation. Do not update these
files when the platform changes; they are the previous-release fixture.
