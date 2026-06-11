import { Router } from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import {
  CreateClientSchema,
  CreateProjectSchema,
  CreateGoalSchema,
  CreateTodoSchema,
} from '@allebrum/shared';
import { db } from '../db/client.js';
import { clients, projects, goals, todos, timeEntries, activeTimers } from '../db/schema.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requirePermission } from '../auth/permissions.js';
import { createClient } from '../services/clients.js';
import { createProject } from '../services/projects.js';
import { createGoal } from '../services/goals.js';
import { createTodo } from '../services/todos.js';
import { tenantEq } from '../tenancy/scope.js';

/**
 * First-run sample data: one click creates a clearly-marked demo client +
 * project + goal + to-dos so a brand-new workspace shows the product working;
 * one click removes it again. The marker is the client NAME — if an admin
 * renames the sample client they've adopted it as real data, and removal
 * intentionally no longer matches.
 */
export const onboardingRouter = Router();
onboardingRouter.use(requireAuth);

export const SAMPLE_CLIENT_NAME = 'Sample — Hopscotch Agency';

onboardingRouter.post('/sample-data', requirePermission('clients.manage'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const existing = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(tenantEq(clients.tenantId), eq(clients.name, SAMPLE_CLIENT_NAME)))
      .limit(1);
    if (existing[0]) {
      res.json({ created: false, clientId: existing[0].id });
      return;
    }

    const client = await createClient(
      CreateClientSchema.parse({ name: SAMPLE_CLIENT_NAME, kind: 'agency', color: '#0ea5e9' }),
      me.userId,
    );
    const project = await createProject(
      CreateProjectSchema.parse({
        clientId: client.id,
        name: 'Website refresh',
        code: 'SAMPLE',
        budgetHrs: 40,
        billable: true,
        color: '#0ea5e9',
      }),
      me.userId,
    );
    const inTwoWeeks = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    await createGoal(
      CreateGoalSchema.parse({
        clientId: client.id,
        projectId: project.id,
        title: 'Launch the new homepage',
        status: 'in-progress',
        priority: 'high',
        endDate: inTwoWeeks,
        health: 'on-track',
        progress: 40,
      }),
      me.userId,
    );
    const sampleTodos = [
      { title: 'Review the kickoff checklist', estimateMin: 30 },
      { title: 'Draft homepage copy', estimateMin: 120 },
      { title: 'Collect brand assets from the client', estimateMin: 60 },
    ];
    for (const t of sampleTodos) {
      await createTodo(
        CreateTodoSchema.parse({ ...t, clientId: client.id, projectId: project.id }),
        me.userId,
      );
    }
    res.status(201).json({ created: true, clientId: client.id });
  } catch (e) {
    next(e);
  }
});

onboardingRouter.delete('/sample-data', requirePermission('clients.manage'), async (req, res, next) => {
  try {
    const found = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(tenantEq(clients.tenantId), eq(clients.name, SAMPLE_CLIENT_NAME)))
      .limit(1);
    const clientId = found[0]?.id;
    if (!clientId) {
      res.status(404).json({ error: 'sample_not_found' });
      return;
    }
    const projRows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(tenantEq(projects.tenantId), eq(projects.clientId, clientId)));
    const projIds = projRows.map((p) => p.id);

    await db.transaction(async (tx) => {
      // Order matters: children first, and time entries/timers reference
      // projects with ON DELETE RESTRICT — detach them (entries become
      // project-less, which the app supports) so logged time is never lost.
      if (projIds.length > 0) {
        await tx.update(timeEntries).set({ projectId: null }).where(and(tenantEq(timeEntries.tenantId), inArray(timeEntries.projectId, projIds)));
        await tx.update(activeTimers).set({ projectId: null }).where(and(tenantEq(activeTimers.tenantId), inArray(activeTimers.projectId, projIds)));
      }
      await tx.delete(todos).where(and(tenantEq(todos.tenantId), eq(todos.clientId, clientId)));
      await tx.delete(goals).where(and(tenantEq(goals.tenantId), eq(goals.clientId, clientId)));
      if (projIds.length > 0) {
        await tx.delete(projects).where(and(tenantEq(projects.tenantId), inArray(projects.id, projIds)));
      }
      await tx.delete(clients).where(and(tenantEq(clients.tenantId), eq(clients.id, clientId)));
    });
    res.json({ removed: true });
  } catch (e) {
    next(e);
  }
});
