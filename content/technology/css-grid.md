---
title: CSS Grid 的二维布局心智模型
date: 2026-09-16
description: 从轨道、网格线和空间分配理解 CSS Grid，而不是背属性。
tags:
  - css
  - frontend
---

# CSS Grid 的二维布局心智模型

Grid 先定义行与列组成的轨道，再把元素放进这些轨道。它适合同时控制横向和纵向关系。

```css
.cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
```

当屏幕变窄时，将列数改为一列，比压缩内容宽度更利于阅读。
