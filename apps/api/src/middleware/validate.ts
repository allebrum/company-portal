import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';

type Source = 'body' | 'query' | 'params';

export function validate<T>(schema: ZodSchema<T>, source: Source = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      res.status(400).json({
        error: 'validation_failed',
        source,
        issues: result.error.issues,
      });
      return;
    }
    (req as Request & { validated: Record<Source, unknown> }).validated ??= {} as Record<Source, unknown>;
    (req as Request & { validated: Record<Source, unknown> }).validated[source] = result.data;
    next();
  };
}

export function getValidated<T>(req: Request, source: Source = 'body'): T {
  const bag = (req as Request & { validated?: Record<Source, unknown> }).validated;
  return (bag?.[source] as T) ?? (req[source] as T);
}
