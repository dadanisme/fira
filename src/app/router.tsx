import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { Home } from './Home';
import { Layout } from './Layout';

// Feature route modules are lazy loaded; each default-exports its page component.
const BoardPage = lazy(() => import('../features/board/BoardPage'));
const DocPage = lazy(() => import('../features/docs/DocPage'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage'));

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      // One route for board + side peek, so opening a card does not remount the board.
      { path: 'p/:projectKey/:cardKey?', element: <BoardPage /> },
      { path: 'd/:pageId', element: <DocPage /> },
      { path: 'settings/*', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
