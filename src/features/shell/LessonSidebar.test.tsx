import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useLessonStore } from '@/stores/lesson';
import { LessonSidebar } from './LessonSidebar';

function renderSidebar(activeId = 'how-to-use', onOpenSearch = vi.fn()) {
  render(
    <MemoryRouter>
      <TooltipProvider>
        <LessonSidebar activeId={activeId} onOpenSearch={onOpenSearch} />
      </TooltipProvider>
    </MemoryRouter>,
  );
  return onOpenSearch;
}

describe('LessonSidebar', () => {
  it('показывает главы с уроками и номера', () => {
    renderSidebar();
    expect(screen.getByText('0. Старт')).toBeInTheDocument();
    expect(screen.getByText('4. Выборка из одной таблицы')).toBeInTheDocument();
    expect(screen.queryByText('6. Соединения')).not.toBeInTheDocument();
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
    expect(screen.getByText('Пройдено 1 из 2')).toBeInTheDocument();
  });

  it('активный урок помечен', () => {
    renderSidebar('select-basics');
    expect(screen.getByRole('link', { name: /SELECT: колонки/ })).toHaveAttribute('data-active', 'true');
  });

  it('кнопка поиска вызывает onOpenSearch', async () => {
    const onOpenSearch = renderSidebar();
    await userEvent.click(screen.getByRole('button', { name: /Поиск/ }));
    expect(onOpenSearch).toHaveBeenCalledOnce();
  });
});
