import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { FoundationStatus } from './ui/FoundationStatus.js';
import './ui/foundation-status.css';

const root = document.querySelector<HTMLElement>('#root');

if (root === null) {
  throw new Error('APP_ROOT_MISSING: expected #root mounting element');
}

createRoot(root).render(
  <StrictMode>
    <FoundationStatus />
  </StrictMode>,
);
