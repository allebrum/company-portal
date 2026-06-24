import { Router } from 'express';
import multer from 'multer';
import { CreateTodoSchema, UpdateTodoSchema } from '@modernzen/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAnyPermission } from '../auth/permissions.js';
import { validate, getValidated } from '../middleware/validate.js';
import {
  listVisibleTodos,
  createTodo,
  updateTodo,
  toggleTodo,
  deleteTodo,
} from '../services/todos.js';
import { uploadTodoFile } from '../services/todoFiles.js';

// Same 100MB cap as /spaces and /drive uploads.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
// Uploading IS a media action — same gate as /spaces (NOT a todo-edit
// permission). Stops permission-mismatch half-writes the same way F17 fixed
// for spaceFiles.
const uploadAccess = requireAnyPermission('media.manage', 'integrations.manage');

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

// F25: upload a file as a todo attachment. Mirrors the spaces upload path
// — one server-side step that uploads to the parent project's Drive folder
// AND atomically appends to `todos.attachments`. Half-writes are prevented
// by trashing the Drive file if the JSONB append fails.
todosRouter.post('/:id/files', uploadAccess, upload.single('file'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: 'file_required' });
      return;
    }
    const result = await uploadTodoFile({
      todoId: req.params.id!,
      whoId: me.userId,
      filename: file.originalname,
      mimeType: file.mimetype,
      buffer: file.buffer,
    });
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});
