import { QueryClientProvider } from '@tanstack/react-query';
import { fontFaceCss } from '@cv/cv-template';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { App } from './App';
import { createQueryClient } from './api/query-client';
import { CrashMessage } from './components/CrashBoundary';
import './index.css';

// The same font files as the CV preview, served from this origin (see vite.config.ts).
const fonts = document.createElement('style');
fonts.textContent = fontFaceCss({ baseUrl: '/fonts' });
document.head.append(fonts);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

const queryClient = createQueryClient();
// A data router, because only it can block a navigation (`useBlocker`) while edits are unsaved.
const router = createBrowserRouter([
  { path: '*', element: <App />, errorElement: <CrashMessage /> },
]);

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
