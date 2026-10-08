# Visual SQL

Визуальный тьютор по PostgreSQL. Слева темы, по центру теория, справа miro-подобная доска с таблицами. Доской управляет SQL: пишешь запрос - и в реальном времени видишь, как Postgres его выполняет: таблицы съезжаются при JOIN, строки отваливаются на WHERE, колонки исчезают на SELECT, строки сбиваются в стопки на GROUP BY. Всё работает в браузере через PGlite (настоящий PostgreSQL в WASM), бэкенда нет.

## Статус

Проект в активной разработке. Закрыт каркас (оболочка, уроки-MDX, CI), слой БД в работе. Доска, редактор и визуализатор запросов - впереди, планы всех фаз готовы в `docs/superpowers/plans/`.

## Быстрый старт

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

Прочие команды: `pnpm check` (typecheck + линт + тесты), `pnpm test`, `pnpm e2e`, `pnpm build`. Первый e2e-прогон: `pnpm exec playwright install chromium`.

## Документация

- `docs/superpowers/specs/2026-10-08-visual-sql-design.md` - спека продукта и архитектуры
- `docs/PROGRESS.md` - трекер всех работ по фазам
- `docs/datasets.md` - учебный датасет bookstore и его особые строки
- `CLAUDE.md` - инструкции для агентов (команды, инварианты, границы модулей)

## Стек

Vite, React 19, TypeScript strict, Tailwind v4 + shadcn/ui, PGlite (PostgreSQL 18 в Web Worker), libpg-query, CodeMirror 6, React Flow, motion, MDX + shiki, zustand, Vitest, Playwright, Biome.
