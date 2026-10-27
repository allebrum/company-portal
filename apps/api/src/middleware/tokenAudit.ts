import type { Request, Response, NextFunction } from 'express';
import { isTokenRequest } from './bearerAuth.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Audit trail for personal-access-token writes: one structured log line per
 * state-changing token request (token id/name, owner, workspace, method,
 * path, status). Never logs the token, headers or body. Mount after pinoHttp.
 * Activity-feed entries are additionally tagged via lib/requestActor.ts.
 */
export function tokenAuditLog(req: Request, res: Response, next: NextFunction): void {
  if (!isTokenRequest(req) || SAFE.has(req.method)) {
    next();
    return;
  }
  res.on('finish', () => {
    req.log?.info(
      {
        audit: 'api_token_write',
        tokenId: req.apiToken?.id,
        tokenName: req.apiToken?.name,
        userId: req.session?.user?.userId,
        tenantId: req.session?.user?.tenantId,
        method: req.method,
        path: req.baseUrl + req.path,
        status: res.statusCode,
      },
      'api token write',
    );
  });
  next();
}
