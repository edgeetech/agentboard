import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import { ThemeProvider } from './theme/ThemeProvider';
import './i18n';
// Self-hosted brand fonts — no external network requests (local-first tool).
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles.css';

declare global {
  interface Window { __AGENTBOARD_TOKEN?: string }
}

// No global refetchInterval: polling every query every 5s hammered heavy
// endpoints even on static pages. Individual queries opt into their own
// refetchInterval where live data matters (board task state, active runs).
const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>
);
