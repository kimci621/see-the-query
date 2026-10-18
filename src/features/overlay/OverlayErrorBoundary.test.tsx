import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OverlayErrorBoundary } from './OverlayErrorBoundary';

function Boom(): never {
  throw new Error('сцена упала');
}

describe('OverlayErrorBoundary', () => {
  it('ловит ошибку сцены, зовёт onError и ничего не рисует', () => {
    const onError = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <OverlayErrorBoundary resetKey={1} onError={onError}>
        <Boom />
      </OverlayErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledOnce();
    expect(container.textContent).toBe('');
    spy.mockRestore();
  });

  it('после смены resetKey снова рендерит детей', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <OverlayErrorBoundary resetKey={1} onError={() => {}}>
        <Boom />
      </OverlayErrorBoundary>,
    );
    rerender(
      <OverlayErrorBoundary resetKey={2} onError={() => {}}>
        <p>ок</p>
      </OverlayErrorBoundary>,
    );
    expect(screen.getByText('ок')).toBeTruthy();
    spy.mockRestore();
  });
});
