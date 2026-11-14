import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Plugin } from 'vite';
import { parse as parseYaml } from 'yaml';
import type { LessonMeta } from '../src/features/lessons/types.ts';
import type { Locale } from '../src/lib/i18n.ts';

const VIRTUAL_ID = 'virtual:lessons-meta';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const LESSONS_DIRS: Record<Locale, string> = { ru: 'content/lessons', en: 'content/lessons-en' };
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

type Raw = Record<string, unknown>;

function requireString(data: Raw, key: string, file: string): string {
  const value = data[key];
  if (typeof value !== 'string' || value.trim() === '') {
    const hint =
      key === 'number' ? ' (номер пиши в кавычках: number: "6.10", иначе YAML превратит его в 6.1)' : '';
    throw new Error(`${file}: поле ${key} должно быть непустой строкой${hint}`);
  }
  return value;
}

function optionalStringArray(data: Raw, key: string, file: string): string[] | undefined {
  const value = data[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new Error(`${file}: поле ${key} должно быть списком строк`);
  }
  return value;
}

// Ссылки на документацию: у каждой адрес и подпись на языке урока
function docLinks(data: Raw, file: string): LessonMeta['docs'] {
  const value = data.docs;
  if (value === undefined || value === null) return [];
  const isLink = (v: unknown) =>
    !!v &&
    typeof v === 'object' &&
    ['url', 'title'].every((k) => {
      const field = (v as Raw)[k];
      return typeof field === 'string' && field.trim() !== '';
    });
  if (!Array.isArray(value) || !value.every(isLink)) {
    throw new Error(`${file}: поле docs должно быть списком { url, title } с непустыми строками`);
  }
  return value.map((v: Raw) => ({ url: v.url as string, title: v.title as string }));
}

// Разбирает frontmatter одного урока. relPath считается от корня проекта
export function parseLessonFile(source: string, relPath: string): LessonMeta {
  const file = relPath.split(path.sep).join('/');
  const match = FRONTMATTER.exec(source);
  if (!match) throw new Error(`${file}: нет frontmatter`);
  const data = parseYaml(match[1] ?? '') as unknown;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${file}: frontmatter должен быть объектом`);
  }
  const raw = data as Raw;

  const order = raw.order;
  if (typeof order !== 'number' || !Number.isInteger(order)) {
    throw new Error(`${file}: поле order должно быть целым числом`);
  }

  const meta: LessonMeta = {
    id: requireString(raw, 'id', file),
    locale: file.startsWith(`${LESSONS_DIRS.en}/`) ? 'en' : 'ru',
    title: requireString(raw, 'title', file),
    chapter: requireString(raw, 'chapter', file),
    number: requireString(raw, 'number', file),
    order,
    dataset: requireString(raw, 'dataset', file) as LessonMeta['dataset'],
    docs: docLinks(raw, file),
    tags: optionalStringArray(raw, 'tags', file) ?? [],
    path: `/${file}`,
  };

  const course = optionalStringArray(raw, 'course', file);
  if (course) meta.course = course;
  if (typeof raw.mvp === 'boolean') meta.mvp = raw.mvp;
  if (typeof raw.initialQuery === 'string') meta.initialQuery = raw.initialQuery;
  if (raw.board && typeof raw.board === 'object') meta.board = raw.board as LessonMeta['board'];
  return meta;
}

export function collectLessonsMeta(
  root: string,
  locale: Locale = 'ru',
  options: { requireAll?: boolean } = {},
): LessonMeta[] {
  const dir = LESSONS_DIRS[locale];
  const files = existsSync(path.join(root, dir)) ? globSync(`${dir}/**/*.mdx`, { cwd: root }).sort() : [];
  const metas = files.map((f) => parseLessonFile(readFileSync(path.join(root, f), 'utf8'), f));
  const seen = new Map<string, string>();
  for (const meta of metas) {
    const prev = seen.get(meta.id);
    if (prev) throw new Error(`Дубль id «${meta.id}»: ${prev} и ${meta.path}`);
    seen.set(meta.id, meta.path);
  }
  if (locale === 'en') {
    const originals = new Map(collectLessonsMeta(root).map((meta) => [meta.id, meta]));
    for (const meta of metas) {
      const original = originals.get(meta.id);
      if (!original) throw new Error(`${meta.id}: нет русского урока для ${meta.path}`);
      for (const key of ['chapter', 'number', 'order', 'dataset', 'board'] as const) {
        if (!isDeepStrictEqual(meta[key], original[key])) {
          throw new Error(`${meta.id}: поле ${key} различается в ${original.path} и ${meta.path}`);
        }
      }
    }
    if (options.requireAll) {
      const missing = [...originals.keys()].filter((id) => !seen.has(id));
      if (missing.length) throw new Error(`Нет английских уроков: ${missing.join(', ')}`);
    }
  }
  return metas;
}

export function lessonsMeta(): Plugin {
  let root = process.cwd();
  return {
    name: 'vs-lessons-meta',
    configResolved(config) {
      root = config.root;
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      return `export const lessonsMeta = ${JSON.stringify([...collectLessonsMeta(root), ...collectLessonsMeta(root, 'en')])};`;
    },
    configureServer(server) {
      const lessonsDirs = Object.values(LESSONS_DIRS).map((dir) => `${path.join(root, dir)}${path.sep}`);
      // Новый, удалённый или изменённый урок: пересобрать список и перезагрузить страницу
      const onChange = (file: string) => {
        if (!lessonsDirs.some((dir) => file.startsWith(dir)) || !file.endsWith('.mdx')) return;
        const env = server.environments.client;
        const mod = env.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) env.moduleGraph.invalidateModule(mod);
        env.hot.send({ type: 'full-reload' });
      };
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
      server.watcher.on('change', onChange);
    },
  };
}
