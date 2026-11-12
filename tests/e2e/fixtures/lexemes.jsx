import '../../../src/index.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SandboxProvider, useSandbox } from '../../../src/features/db/SandboxProvider';
import { LexemeScene } from '../../../src/features/lessons/mdx/LexemeScene';

function Fixture() {
  const { sandbox } = useSandbox();
  const [config, setConfig] = useState('russian');
  useEffect(() => {
    if (sandbox) void sandbox.loadLesson('empty', []);
  }, [sandbox]);
  return (
    <>
      <button type="button" onClick={() => setConfig('simple')}>
        Конфигурация simple
      </button>
      <LexemeScene text="Книги о Python: читаем, читали, будем читать" config={config} />
    </>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Нет элемента для сцены');
createRoot(root).render(
  <SandboxProvider>
    <main className="mx-auto max-w-3xl px-4">
      <Fixture />
    </main>
  </SandboxProvider>,
);
