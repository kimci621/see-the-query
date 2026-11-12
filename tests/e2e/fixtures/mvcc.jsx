import '../../../src/index.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MvccPage } from '../../../src/features/lessons/mdx/MvccPage';

const root = document.getElementById('root');
if (!root) throw new Error('Нет элемента для сцены');
createRoot(root).render(
  <StrictMode>
    <main className="mx-auto max-w-3xl px-4">
      <MvccPage />
    </main>
  </StrictMode>,
);
