import type { Element, ElementContent, Root } from 'hast';
import { createHighlighter, type Highlighter } from 'shiki';

const LANGS = ['sql', 'bash', 'json', 'typescript'];
const LANG_CLASS = /^language-(.+)$/;

let highlighter: Promise<Highlighter> | null = null;

// Один подсветчик на процесс сборки
function getHighlighter(): Promise<Highlighter> {
  highlighter ??= createHighlighter({ themes: ['github-light', 'github-dark'], langs: LANGS });
  return highlighter;
}

function textOf(node: ElementContent): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map(textOf).join('');
  return '';
}

interface Target {
  parent: Root | Element;
  index: number;
  code: Element;
}

function collect(parent: Root | Element, out: Target[]) {
  parent.children.forEach((child, index) => {
    if (child.type !== 'element') return;
    if (child.tagName === 'pre') {
      const code = child.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code');
      if (code) {
        out.push({ parent, index, code });
        return;
      }
    }
    collect(child, out);
  });
}

// Подсвечивает fenced-блоки shiki и кладёт на <pre> data-lang, data-meta и data-code.
// Мета fenced-блока («run expect=rows:9») нужна SqlBlock и тестам контента
export function rehypeCodeMeta() {
  return async (tree: Root) => {
    const targets: Target[] = [];
    collect(tree, targets);
    if (targets.length === 0) return;
    const hl = await getHighlighter();
    const loaded = hl.getLoadedLanguages();

    for (const { parent, index, code } of targets) {
      const classes = Array.isArray(code.properties.className) ? code.properties.className.map(String) : [];
      const lang = classes.map((c) => LANG_CLASS.exec(c)?.[1]).find((l): l is string => Boolean(l)) ?? 'text';
      const rawMeta = (code.data as { meta?: unknown } | undefined)?.meta;
      const meta = typeof rawMeta === 'string' ? rawMeta : '';
      const source = code.children.map(textOf).join('').replace(/\n$/, '');

      const highlighted = hl.codeToHast(source, {
        lang: loaded.includes(lang) ? lang : 'text',
        themes: { light: 'github-light', dark: 'github-dark' },
        defaultColor: false,
      });
      const pre = highlighted.children.find((c): c is Element => c.type === 'element' && c.tagName === 'pre');
      if (!pre) continue;
      pre.properties = { ...pre.properties, 'data-lang': lang, 'data-meta': meta, 'data-code': source };
      parent.children[index] = pre;
    }
  };
}
