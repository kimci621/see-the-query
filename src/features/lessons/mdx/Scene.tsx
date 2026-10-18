import { Children, isValidElement, type ReactNode, useState } from 'react';
import { useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { sendToBoard } from './SqlBlock';

// Исходник первого SQL-блока в поддереве: rehypeCodeMeta кладёт его в data-code на <pre>
export function sqlOf(node: ReactNode): string | null {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ 'data-code'?: unknown; children?: ReactNode }>(child)) continue;
    const code = child.props['data-code'];
    if (typeof code === 'string') return code;
    const nested = sqlOf(child.props.children);
    if (nested !== null) return nested;
  }
  return null;
}

export function Step({ caption, children }: { caption: string; children?: ReactNode }) {
  return (
    <div>
      <p className="font-medium">{caption}</p>
      {children}
    </div>
  );
}

// Срежиссированная последовательность запросов: один шаг на экране, переход шлёт запрос шага на доску
export function Scene({ children }: { children: ReactNode }) {
  const { lessonId } = useParams();
  const [index, setIndex] = useState(0);
  // MDX кладёт между шагами текстовые переводы строк, их отбрасываем
  const steps = Children.toArray(children).filter(isValidElement);

  const go = (next: number) => {
    setIndex(next);
    const sql = sqlOf(steps[next]);
    if (sql !== null) sendToBoard(sql, lessonId);
  };

  return (
    <section aria-label="Сцена" className="my-6 rounded-lg border px-4 py-2">
      <div className="not-prose flex items-center justify-between gap-2 py-2">
        <span className="text-sm text-muted-foreground">
          Шаг {index + 1} из {steps.length}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={index === 0} onClick={() => go(index - 1)}>
            Назад
          </Button>
          <Button size="sm" disabled={index >= steps.length - 1} onClick={() => go(index + 1)}>
            Дальше
          </Button>
        </div>
      </div>
      {steps[index]}
    </section>
  );
}
