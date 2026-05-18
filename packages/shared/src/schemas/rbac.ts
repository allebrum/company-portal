import { z } from 'zod';
import { PERMISSIONS } from '../enums';

export const CreateGroupSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(280).default(''),
  require2fa: z.boolean().default(false),
});
export type CreateGroupInput = z.infer<typeof CreateGroupSchema>;

export const UpdateGroupSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(280).optional(),
  require2fa: z.boolean().optional(),
});
export type UpdateGroupInput = z.infer<typeof UpdateGroupSchema>;

export const SetGroupPermissionsSchema = z.object({
  permissions: z.array(z.enum(PERMISSIONS)),
});
export type SetGroupPermissionsInput = z.infer<typeof SetGroupPermissionsSchema>;

export const SetUserGroupsSchema = z.object({
  groupIds: z.array(z.string().uuid()),
});
export type SetUserGroupsInput = z.infer<typeof SetUserGroupsSchema>;

export const SetUserOverridesSchema = z.object({
  overrides: z.array(
    z.object({
      permission: z.enum(PERMISSIONS),
      effect: z.enum(['grant', 'deny']),
    }),
  ),
});
export type SetUserOverridesInput = z.infer<typeof SetUserOverridesSchema>;
