import { Router } from 'express';
import {
  CreateClientSchema,
  UpdateClientSchema,
  InviteContactSchema,
  UpdateContactSchema,
} from '@modernzen/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireClientInTenant } from '../middleware/requireClientInTenant.js';
import { requirePermission } from '../auth/permissions.js';
import { validate, getValidated } from '../middleware/validate.js';
import { listClients, createClient, updateClient } from '../services/clients.js';
import {
  listContacts,
  inviteContact,
  resendContactInvite,
  updateContact,
  deleteContact,
} from '../services/clientContacts.js';

export const clientsRouter = Router();

clientsRouter.use(requireAuth);

clientsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await listClients());
  } catch (e) {
    next(e);
  }
});

// Any authenticated teammate can create a client (e.g. inline from the
// composer). Editing/renaming stays gated by clients.manage below.
clientsRouter.post('/', validate(CreateClientSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await createClient(getValidated<typeof CreateClientSchema._type>(req), me.userId);
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

clientsRouter.patch('/:id', requirePermission('clients.manage'), validate(UpdateClientSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await updateClient(req.params.id!, getValidated<typeof UpdateClientSchema._type>(req), me.userId);
    res.json(row);
  } catch (e) {
    next(e);
  }
});

// ---- F23 client portal contacts (staff side) -------------------------

clientsRouter.get('/:id/contacts', requirePermission('portal.manage'), requireClientInTenant, async (req, res, next) => {
  try {
    res.json(await listContacts(req.params.id!));
  } catch (e) {
    next(e);
  }
});

clientsRouter.post(
  '/:id/contacts',
  requirePermission('portal.manage'),
  requireClientInTenant,
  validate(InviteContactSchema),
  async (req, res, next) => {
    try {
      const me = req.session.user!;
      const { contact } = await inviteContact({
        clientId: req.params.id!,
        input: getValidated<typeof InviteContactSchema._type>(req),
        whoId: me.userId,
      });
      res.status(201).json(contact);
    } catch (e) {
      next(e);
    }
  },
);

clientsRouter.patch(
  '/:id/contacts/:contactId',
  requirePermission('portal.manage'),
  requireClientInTenant,
  validate(UpdateContactSchema),
  async (req, res, next) => {
    try {
      const me = req.session.user!;
      const row = await updateContact(
        req.params.contactId!,
        getValidated<typeof UpdateContactSchema._type>(req),
        me.userId,
      );
      res.json(row);
    } catch (e) {
      next(e);
    }
  },
);

clientsRouter.delete(
  '/:id/contacts/:contactId',
  requirePermission('portal.manage'),
  requireClientInTenant,
  async (req, res, next) => {
    try {
      const me = req.session.user!;
      await deleteContact(req.params.contactId!, me.userId);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

clientsRouter.post(
  '/:id/contacts/:contactId/resend',
  requirePermission('portal.manage'),
  requireClientInTenant,
  async (req, res, next) => {
    try {
      const me = req.session.user!;
      await resendContactInvite({ contactId: req.params.contactId!, whoId: me.userId });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);
