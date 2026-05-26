import { Router } from 'express';
import { getSettings } from '../services/settings.js';

/**
 * Public (no `requireAuth`) policy content endpoints.
 *
 * Powers the unauthenticated /terms and /privacy pages on the web app. The
 * markdown content lives on the `app_settings` singleton; we just hand it
 * back as a tiny JSON payload with a small cache hint. 404 when an admin
 * hasn't published the policy yet — the page renders an honest empty state.
 */
export const policiesRouter = Router();

policiesRouter.get('/:kind', async (req, res, next) => {
  try {
    const kind = req.params.kind;
    if (kind !== 'terms' && kind !== 'privacy') {
      res.status(404).json({ error: 'unknown_policy' });
      return;
    }
    const settings = await getSettings();
    const content = kind === 'terms' ? settings.termsOfService : settings.privacyPolicy;
    if (!content || content.trim() === '') {
      res.status(404).json({ error: 'policy_not_configured' });
      return;
    }
    // Modest cache so the login page can prefetch cheaply.
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ content });
  } catch (e) {
    next(e);
  }
});
