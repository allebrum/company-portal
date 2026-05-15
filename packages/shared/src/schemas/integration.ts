import { z } from 'zod';
import { INTEGRATION_KINDS } from '../enums';

export const ConnectIntegrationSchema = z.object({
  account: z.string().max(240).optional(),
  autoSync: z.boolean().optional(),
  syncIntervalHours: z.number().int().min(1).max(168).optional(),
  config: z.record(z.unknown()).optional(),
});
export type ConnectIntegrationInput = z.infer<typeof ConnectIntegrationSchema>;

export const IntegrationKindParam = z.object({
  kind: z.enum(INTEGRATION_KINDS),
});

export const LinkFolderSchema = z.object({
  drivePath: z.string().min(1).max(500),
  clientId: z.string().uuid(),
  itemCount: z.number().int().min(0).max(1_000_000).default(0),
});
export type LinkFolderInput = z.infer<typeof LinkFolderSchema>;
