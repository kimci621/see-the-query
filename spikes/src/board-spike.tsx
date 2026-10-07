// Спайк: 30 таблиц по 15 строк, оверлей в ViewportPortal, 200 строк с layoutId перемешиваются
import { createRoot } from 'react-dom/client';
import { useEffect, useState, memo } from 'react';
import { ReactFlow, ReactFlowProvider, ViewportPortal, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import { motion } from 'motion/react';
import '@xyflow/react/dist/style.css';
import { report } from './main';

const W = 260;
const ROW = 24;
let tableRenders = 0;

type TData = { title: string };
const TableNode = memo(function TableNode({ data }: NodeProps<Node<TData>>) {
  tableRenders++;
  return (
    <div style={{ width: W, boxSizing: 'border-box', background: '#fff', border: '1px solid #ccc', borderRadius: 8, font: '12px monospace' }}>
      <div style={{ padding: 8, fontWeight: 600 }}>{data.title}</div>
      {Array.from({ length: 15 }, (_, i) => (
        <div key={i} style={{ height: ROW, borderTop: '1px solid #eee', padding: '0 8px' }}>строка {i + 1}</div>
      ))}
    </div>
  );
});

const nodes: Node<TData>[] = Array.from({ length: 30 }, (_, i) => ({
  id: `t${i}`,
  type: 'table',
  position: { x: (i % 6) * 320, y: Math.floor(i / 6) * 460 },
  data: { title: `public.table_${i}` },
}));
const nodeTypes = { table: TableNode };

function Overlay() {
  const [order, setOrder] = useState(() => Array.from({ length: 200 }, (_, i) => i));
  useEffect(() => {
    const id = setInterval(() => setOrder((o) => [...o].sort(() => Math.random() - 0.5)), 600);
    return () => clearInterval(id);
  }, []);
  return (
    <ViewportPortal>
      {/* призрак таблицы t0 строго поверх ноды t0 */}
      <div data-ghost="t0" style={{ position: 'absolute', left: 0, top: 0, width: W, height: 36 + 15 * ROW, outline: '2px solid #7c3aed', pointerEvents: 'none' }} />
      {/* 200 анимируемых строк в рабочей зоне справа */}
      <div style={{ position: 'absolute', left: 2000, top: 0, width: W }}>
        {order.map((k) => (
          <motion.div key={k} layoutId={`row-${k}`} layout style={{ height: 10, marginBottom: 2, background: `hsl(${(k * 37) % 360} 70% 60%)` }} />
        ))}
      </div>
    </ViewportPortal>
  );
}

function Spike() {
  const rf = useReactFlow();
  useEffect(() => {
    (window as any).__rf = rf;
    (window as any).__renders = () => tableRenders;
  }, [rf]);
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} onlyRenderVisibleElements nodesDraggable={false} elementsSelectable={false} fitView>
        <Overlay />
      </ReactFlow>
    </div>
  );
}

export function run() {
  createRoot(document.getElementById('root')!).render(
    <ReactFlowProvider>
      <Spike />
    </ReactFlowProvider>,
  );
  report({ ready: true });
}
