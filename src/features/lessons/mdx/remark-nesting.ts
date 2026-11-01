import { validNestingPath } from './nesting-path.ts';

export function remarkNesting() {
  return (tree: unknown, file: { fail(message: string): never }) => {
    const visit = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const element = node as { type?: string; name?: string; attributes?: unknown[]; children?: unknown[] };
      if (
        (element.type === 'mdxJsxFlowElement' || element.type === 'mdxJsxTextElement') &&
        element.name === 'Nesting'
      ) {
        const attributes = (element.attributes ?? []) as Array<{
          type: string;
          name?: string;
          value?: unknown;
        }>;
        const paths = attributes.filter(
          (attribute) => attribute.type === 'mdxJsxAttribute' && attribute.name === 'path',
        );
        const path = paths[0]?.value;
        if (
          attributes.some((attribute) => attribute.type !== 'mdxJsxAttribute') ||
          paths.length !== 1 ||
          typeof path !== 'string' ||
          !validNestingPath(path)
        ) {
          file.fail('Nesting: path должен быть строкой из трёх непустых частей: база/схема/таблица');
        }
      }
      element.children?.forEach(visit);
    };
    visit(tree);
  };
}
