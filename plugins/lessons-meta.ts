import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { parse as parseYaml } from 'yaml';
import type { LessonMeta } from '../src/features/lessons/types.ts';

const VIRTUAL_ID = 'virtual:lessons-meta';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const LESSONS_GLOB = 'content/lessons/**/*.mdx';
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
    title: requireString(raw, 'title', file),
    chapter: requireString(raw, 'chapter', file),
    number: requireString(raw, 'number', file),
    order,
    dataset: requireString(raw, 'dataset', file) as LessonMeta['dataset'],
    docs: optionalStringArray(raw, 'docs', file) ?? [],
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

export function collectLessonsMeta(root: string): LessonMeta[] {
  if (!existsSync(path.join(root, 'content/lessons'))) return [];
  const files = globSync(LESSONS_GLOB, { cwd: root }).sort();
  const metas = files.map((f) => parseLessonFile(readFileSync(path.join(root, f), 'utf8'), f));
  const seen = new Map<string, string>();
  for (const meta of metas) {
    const prev = seen.get(meta.id);
    if (prev) throw new Error(`Дубль id «${meta.id}»: ${prev} и ${meta.path}`);
    seen.set(meta.id, meta.path);
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
      return `export const lessonsMeta = ${JSON.stringify(collectLessonsMeta(root))};`;
    },
    configureServer(server) {
      const lessonsDir = path.join(root, 'content', 'lessons');
      // Новый, удалённый или изменённый урок: пересобрать список и перезагрузить страницу
      const onChange = (file: string) => {
        if (!file.startsWith(lessonsDir) || !file.endsWith('.mdx')) return;
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
