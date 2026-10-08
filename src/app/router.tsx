import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { LESSONS } from '@/features/lessons/registry';
import { AppShell } from '@/features/shell/AppShell';

const first = LESSONS[0];

export const routes: RouteObject[] = [
  // Без уроков редиректить некуда: показываем оболочку с «Урок не найден»
  { path: '/', element: first ? <Navigate to={`/l/${first.id}`} replace /> : <AppShell /> },
  { path: '/l/:lessonId', element: <AppShell /> },
  { path: '*', element: <Navigate to="/" replace /> },
];

export const router = createBrowserRouter(routes);
