import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { Home } from './Home';
import { Landing } from './Landing';
import { Layout } from './Layout';
import { RootRedirect } from './RootRedirect';
import { WorkspaceIndexRedirect, WorkspaceRoute } from './WorkspaceRoute';

// Feature route modules are lazy loaded; each default-exports its page component.
const BoardPage = lazy(() => import('../features/board/BoardPage'));
const DocPage = lazy(() => import('../features/docs/DocPage'));
const TrashPage = lazy(() => import('../features/docs/TrashPage'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage'));

/** Every in-app URL is under `/w/:slug` (SPEC.md "Board", routing). */
export const router = createBrowserRouter([
  { index: true, element: <RootRedirect /> },
  { path: 'workspaces', element: <Landing /> },
  {
    path: 'w/:slug',
    element: <WorkspaceRoute />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <Home /> },
          // One route for board + card dialog, so opening a card does not remount the board.
          { path: 'p/:projectKey/:cardKey?', element: <BoardPage /> },
          { path: 'd/:pageId', element: <DocPage /> },
          { path: 'trash', element: <TrashPage /> },
          { path: 'settings/*', element: <SettingsPage /> },
          { path: '*', element: <WorkspaceIndexRedirect /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
