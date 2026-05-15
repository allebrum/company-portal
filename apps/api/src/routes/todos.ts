import { Router } from 'express';
import { CreateTodoSchema, UpdateTodoSchema } from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate, getValidated } from '../middleware/validate.js';
import {
  listVisibleTodos,
  createTodo,
  updateTodo,
  toggleTodo,
  deleteTodo,
} from '../services/todos.js';

export const todosRouter = Router();

todosRouter.use(requireAuth);

todosRouter.get('/', async (req, res, next) => {
  try {
    const me = req.session.user!;
    res.json(await listVisibleTodos(me.userId));
  } catch (e) {
    next(e);
  }
});

todosRouter.post('/', validate(CreateTodoSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await createTodo(getValidated<typeof CreateTodoSchema._type>(req), me.userId);
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

todosRouter.patch('/:id', validate(UpdateTodoSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await updateTodo(req.params.id!, getValidated<typeof UpdateTodoSchema._type>(req), me.userId);
    res.json(row);
  } catch (e) {
    next(e);
  }
});

todosRouter.post('/:id/toggle', async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await toggleTodo(req.params.id!, me.userId);
    res.json(row);
  } catch (e) {
    next(e);
  }
});

todosRouter.delete('/:id', async (req, res, next) => {
  try {
    const me = req.session.user!;
    await deleteTodo(req.params.id!, me.userId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
