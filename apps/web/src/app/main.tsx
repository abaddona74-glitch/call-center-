import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/shared/i18n';
import { createQueryClient } from '@/shared/api';
import { createAppRouter } from './router/router';
import './styles/index.css';

const queryClient = createQueryClient();
const router = createAppRouter(queryClient);

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
