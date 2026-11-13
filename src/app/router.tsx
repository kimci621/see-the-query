import { createBrowserRouter, Navigate, type RouteObject, useLocation } from 'react-router';
import { LESSONS } from '@/features/lessons/registry';
import { AppShell } from '@/features/shell/AppShell';
import { LocaleBoundary } from './LocaleBoundary';

const first = LESSONS[0];

function Redirect({ pathname }: { pathname: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname, search, hash }} replace />;
}

export const routes: RouteObject[] = [
  {
    element: <LocaleBoundary />,
    children: [
      // Без уроков редиректить некуда: показываем оболочку с «Урок не найден»
      { path: '/', element: first ? <Redirect pathname={`/l/${first.id}`} /> : <AppShell /> },
      { path: '/l/:lessonId', element: <AppShell /> },
      { path: '*', element: <Redirect pathname="/" /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
