import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWorkerClient } from './client';
import { SandboxProvider, useSandbox } from './SandboxProvider';

vi.mock('./client', () => ({ createWorkerClient: vi.fn() }));

function Probe() {
  const { sandbox, status } = useSandbox();
  return <p>{sandbox ? `sandbox ${status}` : 'нет песочницы'}</p>;
}

describe('SandboxProvider', () => {
  it('рендерит детей сразу, а worker не создаёт до загрузки урока', async () => {
    render(
      <SandboxProvider>
        <h1>Теория</h1>
        <Probe />
      </SandboxProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Теория' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('sandbox booting')).toBeInTheDocument());
    expect(createWorkerClient).not.toHaveBeenCalled();
  });
});
