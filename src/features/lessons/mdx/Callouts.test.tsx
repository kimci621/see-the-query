import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Callout, Cheatsheet, DontDoThis, TlDr } from './Callouts';

describe('выноски урока', () => {
  it('TlDr показывает суть и подсказку для скринридера', () => {
    render(<TlDr>Возвращает только строки с парой.</TlDr>);
    expect(screen.getByText('Возвращает только строки с парой.')).toBeInTheDocument();
    expect(screen.getByText('Коротко:')).toHaveClass('sr-only');
  });

  it('Callout подписан по виду', () => {
    render(
      <>
        <Callout kind="analogy">а</Callout>
        <Callout kind="trap">б</Callout>
        <Callout kind="tip">в</Callout>
        <Callout kind="note">г</Callout>
      </>,
    );
    for (const name of ['Аналогия', 'Ловушка', 'В продакшене', 'Заметка']) {
      expect(screen.getByRole('note', { name })).toBeInTheDocument();
    }
  });

  it('DontDoThis ведёт на PG wiki в новой вкладке', () => {
    const href = "https://wiki.postgresql.org/wiki/Don't_Do_This#Don't_use_NOT_IN";
    render(<DontDoThis href={href}>Не используй NOT IN.</DontDoThis>);
    const link = screen.getByRole('link', { name: /Don't Do This/ });
    expect(link).toHaveAttribute('href', href);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('Cheatsheet с заголовком', () => {
    render(<Cheatsheet>список</Cheatsheet>);
    expect(screen.getByRole('heading', { name: 'Шпаргалка' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Шпаргалка' })).toHaveTextContent('список');
  });
});
