import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSettingsStore } from '@/stores/settings';
import { mdxComponents } from './components';
import { Nesting } from './Nesting';

describe('Nesting', () => {
  it('подписывает вложенные уровни на английском', () => {
    useSettingsStore.setState({ locale: 'en' });
    render(<Nesting path="postgres/public/book" />);
    expect(
      screen.getByRole('figure', { name: 'cluster, database postgres, schema public, table book' }),
    ).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL cluster')).toBeInTheDocument();
    useSettingsStore.setState({ locale: 'ru' });
  });
  it('показывает четыре вложенных уровня с доступным названием', () => {
    render(<Nesting path="postgres/public/book" />);
    const figure = screen.getByRole('figure', { name: 'кластер, база postgres, схема public, таблица book' });
    const cluster = within(figure).getByText('Кластер PostgreSQL');
    const database = within(figure).getByText('база postgres');
    const schema = within(figure).getByText('схема public');
    const table = within(figure).getByText('таблица book');
    expect(cluster.parentElement).toContainElement(database);
    expect(database.parentElement).toContainElement(schema);
    expect(schema.parentElement).toContainElement(table);
  });

  it('доступен урокам без импорта', () => {
    expect(mdxComponents.Nesting).toBe(Nesting);
  });
});
