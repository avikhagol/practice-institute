import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/fraunces/full-italic.css';
import '@fontsource-variable/source-sans-3/index.css';
import '@fontsource/noto-sans-devanagari/devanagari-400.css';
import '@fontsource/noto-sans-devanagari/devanagari-600.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/institute.css';
import { AttemptsProvider } from './state/attempts';
import { App } from './App';
import { StoreProvider } from './state/store';
import { ConnectionProvider } from './state/connection';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConnectionProvider>
      <StoreProvider>
        <AttemptsProvider><App /></AttemptsProvider>
      </StoreProvider>
    </ConnectionProvider>
  </StrictMode>,
);
