import { z } from 'zod';

// Zod schemas for every boundary (IPC, HTTP, files on disk). Board schemas arrive in M1.
export const pingResponseSchema = z.object({
  message: z.literal('pong'),
  at: z.iso.datetime(),
});
