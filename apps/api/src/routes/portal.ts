import { Router } from 'express';
import { eq, and, isNotNull, inArray, gte, asc } from 'drizzle-orm';
import {
  PortalRequestAccessSchema,
  PortalExchangeSchema,
} from '@allebrum/shared';
import { db } from '../db/client.js';
import {
  clients,
  clientContacts,
  projects,
  goals,
  milestones,
  todos,
} from '../db/schema.js';
import { validate, getValidated } from '../middleware/validate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { findContactByEmail, resendContactInvite } from '../services/clientContacts.js';
import { consumeToken, type TokenSubject } from '../auth/tokens.js';
import { requireClientPortalAuth } from '../middleware/requireClientPortalAuth.js';

/**
 * F23 client-portal routes — split into three surface areas:
 *
 *   PUBLIC (no auth)
 *     - GET  /portal/lookup?slug=…           → branding + client name
 *     - POST /portal/request-access           → magic-link email
 *     - POST /portal/exchange                 → consume token, set session
 *
 *   PORTAL-SESSION (requireClientPortalAuth)
 *     - GET  /portal/me                       → who am I + which client
 *     - POST /portal/logout                   → clear session
 *
 * Phase 2 will add the read endpoints (overview / projects / goals /
 * files); Phase 3 adds the tickets surface. Each stays gated on
 * `req.session.clientPortalSession.clientId` so no caller can leak
 * another client's data.
 */

export const portalRouter = Router();

// ---- Public lookup ----------------------------------------------------

/**
 * Resolve a slug → minimal public-safe payload. Returns 404 if no client
 * has that slug OR the portal hasn't been published. The public login
 * page calls this before showing the email form so it can render the
 * client name and bail out cleanly on bad slugs.
 */
portalRouter.get('/lookup', async (req, res, next) => {
  try {
    const slug = String(req.query.slug ?? '').toLowerCase().trim();
    if (!slug) {
      res.status(400).json({ error: 'slug_required' });
      return;
    }
    const rows = await db
      .select({
        id: clients.id,
        name: clients.name,
        color: clients.color,
        portalPublishedAt: clients.portalPublishedAt,
      })
      .from(clients)
      .where(eq(clients.portalSlug, slug))
      .limit(1);
    const c = rows[0];
    if (!c || !c.portalPublishedAt) {
      res.status(404).json({ error: 'portal_not_found' });
      return;
    }
    res.json({ name: c.name, color: c.color, slug });
  } catch (e) {
    next(e);
  }
});

// ---- Public "send me a magic link" ------------------------------------

portalRouter.post(
  '/request-access',
  rateLimit({ key: 'portal-request', max: 6, windowSec: 60 }),
  validate(PortalRequestAccessSchema),
  async (req, res, next) => {
    try {
      const { slug, email } = getValidated<typeof PortalRequestAccessSchema._type>(req);

      // Anti-enumeration: regardless of whether the slug/email pair matches
      // anything, always 200. The route does the look-up and the email
      // send when there's a match; otherwise it returns immediately.
      const [client] = await db
        .select({ id: clients.id, portalPublishedAt: clients.portalPublishedAt })
        .from(clients)
        .where(eq(clients.portalSlug, slug.toLowerCase()))
        .limit(1);

      if (client?.portalPublishedAt) {
        const contact = await findContactByEmail(client.id, email);
        if (contact) {
          try {
            await resendContactInvite({ contactId: contact.id, whoId: contact.id });
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[portal] request-access send failed', e);
          }
        }
      }

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

// ---- Public token exchange (sets session) ----------------------------

portalRouter.post(
  '/exchange',
  rateLimit({ key: 'portal-exchange', max: 12, windowSec: 60 }),
  validate(PortalExchangeSchema),
  async (req, res, next) => {
    try {
      const { slug, token } = getValidated<typeof PortalExchangeSchema._type>(req);
      const subject: TokenSubject = await consumeToken(token, 'portal-magic');
      if (subject.kind !== 'contact') {
        res.status(400).json({ error: 'invalid_token' });
        return;
      }

      // Verify slug + contact line up — defense against a token issued
      // for client A being used at client B's portal slug.
      const [contact] = await db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.id, subject.contactId))
        .limit(1);
      if (!contact) {
        res.status(400).json({ error: 'invalid_token' });
        return;
      }
      const [client] = await db
        .select({ id: clients.id, slug: clients.portalSlug, publishedAt: clients.portalPublishedAt })
        .from(clients)
        .where(and(eq(clients.id, contact.clientId), isNotNull(clients.portalPublishedAt)))
        .limit(1);
      if (!client || client.slug !== slug.toLowerCase()) {
        res.status(400).json({ error: 'invalid_token' });
        return;
      }

      // Record the acceptance + last-active timestamps. acceptedAt only
      // ever fills once; lastActiveAt rolls forward on every session set.
      const now = new Date().toISOString();
      await db
        .update(clientContacts)
        .set({
          acceptedAt: contact.acceptedAt ?? now,
          lastActiveAt: now,
        })
        .where(eq(clientContacts.id, contact.id));

      req.session.clientPortalSession = {
        contactId: contact.id,
        clientId: contact.clientId,
        slug: client.slug!,
      };
      res.json({ ok: true, slug: client.slug });
    } catch (e) {
      next(e);
    }
  },
);

// ---- Session-gated identity --------------------------------------------

portalRouter.get('/me', requireClientPortalAuth, async (req, res, next) => {
  try {
    const sess = req.session.clientPortalSession!;
    const [contact] = await db
      .select()
      .from(clientContacts)
      .where(eq(clientContacts.id, sess.contactId))
      .limit(1);
    const [client] = await db
      .select({ id: clients.id, name: clients.name, color: clients.color, slug: clients.portalSlug })
      .from(clients)
      .where(eq(clients.id, sess.clientId))
      .limit(1);
    if (!contact || !client) {
      // Session points at a row that's been deleted under us. Clear it.
      req.session.clientPortalSession = undefined;
      res.status(401).json({ error: 'session_invalidated' });
      return;
    }
    res.json({
      contact: { id: contact.id, name: contact.name, email: contact.email, role: contact.role },
      client: { id: client.id, name: client.name, color: client.color, slug: client.slug },
    });
  } catch (e) {
    next(e);
  }
});

portalRouter.post('/logout', requireClientPortalAuth, (req, res) => {
  req.session.clientPortalSession = undefined;
  res.json({ ok: true });
});

// ---- Session-gated read endpoints (curated portal view) ---------------
//
// Every endpoint scopes its queries to `req.session.clientPortalSession.clientId`.
// Cross-client probes (passing an explicit clientId in the body or query)
// are ignored — the session is the only authority.
//
// Field sanitization: goals expose `id, projectId, title, status,
// progress, dueDate` only — internal flags (health, owner, dependsOn,
// tag, checklist, resources) stay private. Projects expose the
// dashboard-shaped rollup; files come from `client.spaceFiles` (Phase 4
// will gate on a per-file `sharedWithClient` flag).

type RollupProjectRow = {
  id: string;
  name: string;
  code: string;
  color: string;
  goalCount: number;
  openTodoCount: number;
  avgProgress: number;
};

async function buildProjectRollup(clientId: string): Promise<RollupProjectRow[]> {
  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      code: projects.code,
      color: projects.color,
    })
    .from(projects)
    .where(eq(projects.clientId, clientId))
    .orderBy(asc(projects.name));
  if (projectRows.length === 0) return [];

  const projectIds = projectRows.map((p) => p.id);
  const goalRows = await db
    .select({
      projectId: goals.projectId,
      progress: goals.progress,
    })
    .from(goals)
    .where(inArray(goals.projectId, projectIds));
  const todoRows = await db
    .select({ projectId: todos.projectId, status: todos.status })
    .from(todos)
    .where(inArray(todos.projectId, projectIds));

  return projectRows.map((p) => {
    const goalsForProject = goalRows.filter((g) => g.projectId === p.id);
    const openTodos = todoRows.filter((t) => t.projectId === p.id && t.status === 'open').length;
    const avg =
      goalsForProject.length > 0
        ? Math.round(
            goalsForProject.reduce((s, g) => s + (g.progress ?? 0), 0) / goalsForProject.length,
          )
        : 0;
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      color: p.color,
      goalCount: goalsForProject.length,
      openTodoCount: openTodos,
      avgProgress: avg,
    };
  });
}

portalRouter.get('/overview', requireClientPortalAuth, async (req, res, next) => {
  try {
    const sess = req.session.clientPortalSession!;
    const [client] = await db
      .select({ id: clients.id, name: clients.name, color: clients.color, slug: clients.portalSlug, spaceFiles: clients.spaceFiles })
      .from(clients)
      .where(eq(clients.id, sess.clientId))
      .limit(1);
    if (!client) {
      res.status(404).json({ error: 'client_not_found' });
      return;
    }
    const projectRollup = await buildProjectRollup(sess.clientId);

    // In-flight goals: status not 'done' and health (if present) not 'done'.
    const goalRows = await db
      .select({
        id: goals.id,
        projectId: goals.projectId,
        title: goals.title,
        status: goals.status,
        progress: goals.progress,
        endDate: goals.endDate,
        health: goals.health,
      })
      .from(goals)
      .where(eq(goals.clientId, sess.clientId));
    const inFlightGoals = goalRows
      .filter((g) => g.status !== 'done' && g.health !== 'done')
      .slice(0, 12)
      .map((g) => ({
        id: g.id,
        projectId: g.projectId,
        title: g.title,
        status: g.status,
        progress: g.progress,
        dueDate: g.endDate,
      }));

    // Upcoming milestones (next 90 days) for this client's projects.
    const projectIds = projectRollup.map((p) => p.id);
    const today = new Date().toISOString().slice(0, 10);
    const milestoneRows = projectIds.length
      ? await db
          .select({
            id: milestones.id,
            projectId: milestones.projectId,
            title: milestones.title,
            date: milestones.date,
            kind: milestones.kind,
          })
          .from(milestones)
          .where(and(inArray(milestones.projectId, projectIds), gte(milestones.date, today)))
          .orderBy(asc(milestones.date))
      : [];

    res.json({
      client: { id: client.id, name: client.name, color: client.color, slug: client.slug },
      projects: projectRollup,
      inFlightGoals,
      upcomingMilestones: milestoneRows.slice(0, 6),
      fileCount: Array.isArray(client.spaceFiles) ? client.spaceFiles.length : 0,
    });
  } catch (e) {
    next(e);
  }
});

portalRouter.get('/projects', requireClientPortalAuth, async (req, res, next) => {
  try {
    const sess = req.session.clientPortalSession!;
    res.json(await buildProjectRollup(sess.clientId));
  } catch (e) {
    next(e);
  }
});

portalRouter.get('/goals', requireClientPortalAuth, async (req, res, next) => {
  try {
    const sess = req.session.clientPortalSession!;
    const rows = await db
      .select({
        id: goals.id,
        projectId: goals.projectId,
        title: goals.title,
        status: goals.status,
        progress: goals.progress,
        endDate: goals.endDate,
      })
      .from(goals)
      .where(eq(goals.clientId, sess.clientId))
      .orderBy(asc(goals.title));
    res.json(
      rows.map((g) => ({
        id: g.id,
        projectId: g.projectId,
        title: g.title,
        status: g.status,
        progress: g.progress,
        dueDate: g.endDate,
      })),
    );
  } catch (e) {
    next(e);
  }
});

portalRouter.get('/files', requireClientPortalAuth, async (req, res, next) => {
  try {
    const sess = req.session.clientPortalSession!;
    const [client] = await db
      .select({ spaceFiles: clients.spaceFiles })
      .from(clients)
      .where(eq(clients.id, sess.clientId))
      .limit(1);
    if (!client) {
      res.json([]);
      return;
    }
    // Phase 4 will gate on a per-file `sharedWithClient` flag; for v1 we
    // expose the whole array. Internal staff today only put client-
    // appropriate files in Spaces, but make this opt-in before merging
    // Phase 4 so existing rows don't leak retroactively.
    const files = (Array.isArray(client.spaceFiles) ? client.spaceFiles : []) as Array<{
      id: string;
      title: string;
      url: string;
      meta?: string;
      addedAt: string;
    }>;
    res.json(files.map((f) => ({ id: f.id, title: f.title, url: f.url, meta: f.meta, addedAt: f.addedAt })));
  } catch (e) {
    next(e);
  }
});
