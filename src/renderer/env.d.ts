import type { PlanciaApi } from '@shared/ipc';

declare global {
  interface Window {
    plancia: PlanciaApi;
  }
}

export {};
