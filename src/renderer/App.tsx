import { useState } from 'react';
import type { PingResponse } from '@shared/ipc';

type PingState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok'; response: PingResponse }
  | { kind: 'error'; message: string };

export function App() {
  const [ping, setPing] = useState<PingState>({ kind: 'idle' });

  async function sendPing() {
    setPing({ kind: 'pending' });
    try {
      const response = await window.plancia.ping();
      setPing({ kind: 'ok', response });
    } catch (err) {
      setPing({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <main className="flex h-full flex-col items-center justify-center gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">Plancia</h1>
      <p className="text-sm text-zinc-400">Scaffold M0 · verifica del canale IPC</p>
      <button
        type="button"
        onClick={() => void sendPing()}
        disabled={ping.kind === 'pending'}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
      >
        Invia ping al processo main
      </button>
      <output className="min-h-6 font-mono text-sm" data-testid="ping-result">
        {ping.kind === 'pending' && 'In attesa…'}
        {ping.kind === 'ok' && `${ping.response.message} · ${ping.response.at}`}
        {ping.kind === 'error' && <span className="text-red-400">Errore: {ping.message}</span>}
      </output>
    </main>
  );
}
