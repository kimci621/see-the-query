import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Callout, Cheatsheet, DontDoThis, NewTabLink, TlDr } from './Callouts';

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
    // читалка слышит, что ссылка откроется в новой вкладке
    const link = screen.getByRole('link', {
      name: "PostgreSQL wiki: Don't Do This (откроется в новой вкладке)",
    });
    expect(link).toHaveAttribute('href', href);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('Cheatsheet с заголовком', () => {
    render(<Cheatsheet>список</Cheatsheet>);
    expect(screen.getByRole('heading', { name: 'Шпаргалка' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Шпаргалка' })).toHaveTextContent('список');
  });

  it('две шпаргалки на странице подписаны каждая своим заголовком, id не повторяются', () => {
    render(
      <>
        <Cheatsheet>первая</Cheatsheet>
        <Cheatsheet>вторая</Cheatsheet>
      </>,
    );
    const [first, second] = screen.getAllByRole('region', { name: 'Шпаргалка' });
    expect(first).toHaveTextContent('первая');
    expect(second).toHaveTextContent('вторая');
    expect(first?.getAttribute('aria-labelledby')).not.toBe(second?.getAttribute('aria-labelledby'));
  });

  it('NewTabLink: новая вкладка, иконка без подписи и пометка для читалки', () => {
    render(<NewTabLink href="https://www.postgresql.org/docs/current/sql-select.html">SELECT</NewTabLink>);
    const link = screen.getByRole('link', { name: 'SELECT (откроется в новой вкладке)' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
