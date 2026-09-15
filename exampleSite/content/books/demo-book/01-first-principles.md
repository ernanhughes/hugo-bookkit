---
title: "First Principles"
description: "The first example chapter."
weight: 10
---

A reusable book runtime should separate **content** from **publishing behavior**.

The consuming repository owns this sentence. BookKit owns how it is rendered and navigated.

```mermaid
graph LR
  Content --> BookKit
  BookKit --> Site
```

Inline math also works: $a^2 + b^2 = c^2$.
