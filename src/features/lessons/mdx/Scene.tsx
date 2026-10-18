import { Children, isValidElement, type ReactNode, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
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
  const back = useRef<HTMLButtonElement>(null);
  const forward = useRef<HTMLButtonElement>(null);
  // MDX кладёт между шагами текстовые переводы строк, их отбрасываем
  const steps = Children.toArray(children).filter(isValidElement);

  const go = (next: number) => {
    // Крайний шаг выключает нажатую кнопку, и фокус улетел бы на body. Переносим его на вторую кнопку:
    // так клавиатура не теряет место, а оверлей видит, что сцену запустил пользователь.
    // flushSync: в сцене из двух шагов вторая кнопка включается только после перерисовки
    flushSync(() => setIndex(next));
    if (next === steps.length - 1) back.current?.focus();
    else if (next === 0) forward.current?.focus();
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
          <Button ref={back} size="sm" variant="outline" disabled={index === 0} onClick={() => go(index - 1)}>
            Назад
          </Button>
          <Button ref={forward} size="sm" disabled={index >= steps.length - 1} onClick={() => go(index + 1)}>
            Дальше
          </Button>
        </div>
      </div>
      {steps[index]}
    </section>
  );
}
