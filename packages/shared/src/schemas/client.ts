import { z } from 'zod';
import { CLIENT_KINDS } from '../enums';

export const CreateClientSchema = z.object({
  name: z.string().min(1).max(160),
  kind: z.enum(CLIENT_KINDS).default('agency'),
  color: z.string().max(20).default('#7e22ce'),
});
// z.input so callers can create with just { name } (kind/color default).
export type CreateClientInput = z.input<typeof CreateClientSchema>;

export const UpdateClientSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  kind: z.enum(CLIENT_KINDS).optional(),
  color: z.string().max(20).optional(),
});
export type UpdateClientInput = z.infer<typeof UpdateClientSchema>;
