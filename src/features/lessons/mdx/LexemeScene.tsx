import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/ui/button';
import { useSandbox } from '@/features/db/SandboxProvider';
import { type LexemeSceneData, loadLexemes } from '@/features/scenes/lexemes';
import { useStepper } from '@/features/scenes/useStepper';
import { useSettingsStore } from '@/stores/settings';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: LexemeSceneData };

export function LexemeScene({ text, config = 'russian' }: { text: string; config?: string }) {
  const locale = useSettingsStore((s) => s.locale);
  const { sandbox, status } = useSandbox();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  useEffect(
    () =>
      sandbox?.subscribe((event) => {
        if (event.type === 'changed') setRevision((current) => current + 1);
      }),
    [sandbox],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision перезагружает словари после изменения базы
  useEffect(() => {
    if (!sandbox || status !== 'ready') {
      setState({ status: 'loading' });
      return;
    }
    let active = true;
    const controller = new AbortController();
    setState({ status: 'loading' });
    void sandbox
      .preview((db) => loadLexemes(db, config, text, locale), controller.signal)
      .then(
        (data) => {
          if (active) setState({ status: 'ready', data });
        },
        (error: unknown) => {
          if (active)
            setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        },
      );
    return () => {
      active = false;
      controller.abort();
    };
  }, [sandbox, status, text, config, revision, locale]);
  if (state.status === 'loading')
    return (
      <p role="status" className="my-6 text-sm text-muted-foreground">
        {locale === 'en' ? 'Analyzing text...' : 'Разбираем текст...'}
      </p>
    );
  if (state.status === 'error')
    return (
      <div role="alert" className="not-prose my-6 rounded-lg border p-4 text-sm">
        <p>
          {locale === 'en' ? 'Could not analyze the text' : 'Не удалось разобрать текст'}: {state.message}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => setRevision((value) => value + 1)}
        >
          {locale === 'en' ? 'Retry' : 'Повторить'}
        </Button>
      </div>
    );
  return <LexemePlayer data={state.data} />;
}

export function LexemePlayer({ data }: { data: LexemeSceneData }) {
  const locale = useSettingsStore((s) => s.locale);
  const { index, next, prev } = useStepper(4);
  const back = useRef<HTMLButtonElement>(null);
  const forward = useRef<HTMLButtonElement>(null);
  const captions =
    locale === 'en'
      ? ['Source text', 'Parsing and stop words', 'Token lexemes', 'Resulting tsvector']
      : ['Исходный текст', 'Разбор и стоп-слова', 'Лексемы токенов', 'Итоговый tsvector'];
  const go = (direction: 'next' | 'prev') => {
    if ((direction === 'prev' && index === 0) || (direction === 'next' && index === 3)) return;
    flushSync(() => (direction === 'next' ? next() : prev()));
    if (direction === 'next' && index === 2) back.current?.focus();
    else if (direction === 'prev' && index === 1) forward.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    go(event.key === 'ArrowRight' ? 'next' : 'prev');
  };
  return (
    <section
      aria-label={locale === 'en' ? 'Text search analysis' : 'Разбор текста для поиска'}
      onKeyDown={onKeyDown}
      className="not-prose my-6 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold">{captions[index]}</p>
        <span role="status" className="text-xs text-muted-foreground">
          {locale === 'en' ? `Step ${index + 1} of 4` : `Шаг ${index + 1} из 4`}
          <span className="sr-only">: {captions[index]}</span>
        </span>
      </div>
      <p className="mt-3 break-words rounded-md bg-muted/40 p-3 text-sm">
        {data.text || (locale === 'en' ? 'Empty text' : 'Пустой текст')}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        {locale === 'en' ? 'Configuration' : 'Конфигурация'}: <code>{data.config}</code>.
      </p>
      {index === 1 && (
        <>
          <ul aria-label={locale === 'en' ? 'Tokens' : 'Токены'} className="mt-3 flex flex-wrap gap-2">
            {data.tokens.map((token) => (
              <li
                key={token.id}
                className={`rounded-md border px-2 py-1 text-sm ${token.kind === 'lexeme' ? 'bg-background' : 'bg-muted/50 text-muted-foreground'}`}
              >
                <span className={token.kind === 'stop' ? 'line-through' : ''}>{token.text}</span>
                {token.kind !== 'lexeme' && (
                  <span className="ml-1 text-xs">
                    {' '}
                    {token.kind === 'stop'
                      ? locale === 'en'
                        ? 'stop word'
                        : 'стоп-слово'
                      : locale === 'en'
                        ? 'unrecognized'
                        : 'не распознан'}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            {locale === 'en'
              ? 'The PostgreSQL parser identifies tokens; some may overlap. Separator tokens are not shown.'
              : 'Токены определяет парсер PostgreSQL; некоторые из них могут перекрываться. Токены-разделители не показаны.'}
          </p>
        </>
      )}
      {index === 2 && (
        <ul
          aria-label={locale === 'en' ? 'Token lexemes' : 'Лексемы токенов'}
          className="mt-3 grid gap-1 text-sm"
        >
          {data.tokens.map((token) => (
            <li key={token.id} className="flex flex-wrap items-baseline gap-2 rounded-md border px-2 py-1">
              <span className="break-all">{token.text}</span>
              <span aria-hidden>→</span>{' '}
              <span className="font-mono text-xs">
                {token.kind === 'stop'
                  ? locale === 'en'
                    ? 'stop word'
                    : 'стоп-слово'
                  : token.kind === 'ignored'
                    ? locale === 'en'
                      ? 'no lexeme'
                      : 'нет лексемы'
                    : token.lexemes.join(', ')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {index === 3 && (
        <>
          <p className="mt-3 text-xs font-medium">
            {locale === 'en' ? 'PostgreSQL result' : 'Результат PostgreSQL'}
          </p>
          <code className="mt-1 block break-all rounded-md border bg-muted/30 p-3 text-xs">
            {data.vector || (locale === 'en' ? 'Empty vector' : 'Пустой вектор')}
          </code>
          <ul
            aria-label={locale === 'en' ? 'Lexeme positions' : 'Позиции лексем'}
            className="mt-2 space-y-1 text-xs text-muted-foreground"
          >
            {data.lexemes.map((item) => (
              <li key={item.lexeme}>
                <code>{item.lexeme}</code>: {locale === 'en' ? 'positions' : 'позиции'}{' '}
                {item.positions.join(', ') || (locale === 'en' ? 'none' : 'нет')}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button ref={back} size="sm" variant="outline" disabled={index === 0} onClick={() => go('prev')}>
          {locale === 'en' ? 'Back' : 'Назад'}
        </Button>
        <Button ref={forward} size="sm" disabled={index === 3} onClick={() => go('next')}>
          {locale === 'en' ? 'Next' : 'Дальше'}
        </Button>
      </div>
    </section>
  );
}
