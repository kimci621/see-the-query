import '../../../src/index.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SandboxProvider, useSandbox } from '../../../src/features/db/SandboxProvider';
import { BTreeScene } from '../../../src/features/lessons/mdx/BTreeScene';

function Fixture() {
  const { sandbox } = useSandbox();
  useEffect(() => {
    if (sandbox) void sandbox.loadLesson('big_bookstore', []);
  }, [sandbox]);
  return <BTreeScene table="orders" index="orders_pkey" column="order_id" value={5000} />;
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
