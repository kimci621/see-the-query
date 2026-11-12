import '../../../src/index.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TwoSessionsBlock } from '../../../src/features/lessons/mdx/TwoSessionsBlock';

const root = document.getElementById('root');
if (!root) throw new Error('Нет элемента для сцены');
createRoot(root).render(
  <StrictMode>
    <main className="mx-auto max-w-3xl px-4">
      <TwoSessionsBlock id={new URLSearchParams(window.location.search).get('id')} />
    </main>
  </StrictMode>,
);
