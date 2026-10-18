import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LESSONS } from '@/features/lessons/registry';
import { useLessonStore } from '@/stores/lesson';
import { LessonSidebar } from './LessonSidebar';

function sidebar(activeId: string, onOpenSearch = vi.fn()) {
  return (
    <MemoryRouter>
      <TooltipProvider>
        <LessonSidebar activeId={activeId} onOpenSearch={onOpenSearch} />
      </TooltipProvider>
    </MemoryRouter>
  );
}

function renderSidebar(activeId = 'how-to-use', onOpenSearch = vi.fn()) {
  render(sidebar(activeId, onOpenSearch));
  return onOpenSearch;
}

describe('LessonSidebar', () => {
  it('показывает главы с уроками и номера', () => {
    renderSidebar();
    expect(screen.getByText('0. Старт')).toBeInTheDocument();
    expect(screen.getByText('4. Выборка из одной таблицы')).toBeInTheDocument();
    expect(screen.queryByText('9. Оконные функции')).not.toBeInTheDocument();
  });

  it('статусы уроков подписаны текстом, а не только иконкой', () => {
    useLessonStore.setState({
      byId: { 'how-to-use': { visited: true, completed: true, journal: [], ranExample: true } },
    });
    renderSidebar();
    const link = screen.getByRole('link', { name: /Как пользоваться доской/ });
    expect(within(link).getByLabelText('пройден')).toBeInTheDocument();
  });

  it('прогресс по программе', () => {
    useLessonStore.setState({
      byId: { 'how-to-use': { visited: true, completed: true, journal: [], ranExample: true } },
    });
    renderSidebar();
    expect(screen.getByText(`Пройдено 1 из ${LESSONS.length}`)).toBeInTheDocument();
  });

  it('активный урок помечен', () => {
    renderSidebar('select-basics');
    expect(screen.getByRole('link', { name: /SELECT: колонки/ })).toHaveAttribute('data-active', 'true');
  });

  it('список глав в навигации «Уроки»', () => {
    renderSidebar();
    expect(screen.getByRole('navigation', { name: 'Уроки' })).toBeInTheDocument();
  });

  it('смена activeId раскрывает главу нового урока', () => {
    const { rerender } = render(sidebar('how-to-use'));
    expect(screen.queryByRole('link', { name: /SELECT: колонки/ })).not.toBeInTheDocument();
    rerender(sidebar('select-basics'));
    expect(screen.getByRole('link', { name: /SELECT: колонки/ })).toBeVisible();
    // ранее открытая глава остаётся открытой
    expect(screen.getByRole('link', { name: /Как пользоваться доской/ })).toBeVisible();
  });

  it('кнопка поиска вызывает onOpenSearch', async () => {
    const onOpenSearch = renderSidebar();
    await userEvent.click(screen.getByRole('button', { name: /Поиск/ }));
    expect(onOpenSearch).toHaveBeenCalledOnce();
  });
});
