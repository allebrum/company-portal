import { Router } from 'express';
import {
  CreateFormSchema,
  PublicFormSubmitSchema,
  TrackFormEventSchema,
  UpdateFormSchema,
} from '@allebrum/shared';
import { env } from '../env.js';
import { requirePermission } from '../auth/permissions.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { getValidated, validate } from '../middleware/validate.js';
import * as formsSvc from '../services/forms.js';

export const formsRouter = Router();
formsRouter.use(requireAuth);

formsRouter.get('/', requirePermission('forms.view'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const clientId = typeof req.query.clientId === 'string' && req.query.clientId ? req.query.clientId : undefined;
    const projectId = typeof req.query.projectId === 'string' && req.query.projectId ? req.query.projectId : undefined;
    res.json(await formsSvc.listVisible({ viewerId: me.userId, clientId, projectId }));
  } catch (e) {
    next(e);
  }
});

formsRouter.post('/', requirePermission('forms.create'), validate(CreateFormSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const input = getValidated<typeof CreateFormSchema._type>(req);
    const row = await formsSvc.create({ ownerId: me.userId, input });
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

formsRouter.patch('/:id', requirePermission('forms.create'), validate(UpdateFormSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const patch = getValidated<typeof UpdateFormSchema._type>(req);
    const row = await formsSvc.update({ id: req.params.id!, ownerId: me.userId, patch });
    res.json(row);
  } catch (e) {
    next(e);
  }
});

formsRouter.delete('/:id', requirePermission('forms.delete'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    await formsSvc.softDelete(req.params.id!, me.userId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

formsRouter.get('/:id/submissions', requirePermission('forms.view'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    res.json(await formsSvc.listSubmissions({ formId: req.params.id!, viewerId: me.userId }));
  } catch (e) {
    next(e);
  }
});

formsRouter.get('/:id/submissions.csv', requirePermission('forms.view'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const id = req.params.id!;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="form-${id}-submissions.csv"`);
    for await (const chunk of formsSvc.submissionsCsvStream({ formId: id, viewerId: me.userId })) {
      res.write(chunk);
    }
    res.end();
  } catch (e) {
    next(e);
  }
});

formsRouter.get('/:id/embed-snippet', requirePermission('forms.view'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await formsSvc.getRowForViewer({ id: req.params.id!, viewerId: me.userId });
    const apiOrigin = `${req.protocol}://${req.get('host')}`;
    const snippet = [
      '<div data-hoppa-form-root></div>',
      `<script src="${apiOrigin}/api/f/embed.js" data-hoppa-form-token="${row.embedToken}" defer></script>`,
    ].join('\n');
    res.json({ token: row.embedToken, snippet, apiOrigin, webOrigin: env.WEB_ORIGIN });
  } catch (e) {
    next(e);
  }
});

export const formsPublicRouter = Router();

const EMBED_JS = String.raw`(() => {
  const NS = '__hoppaForms_v1';
  const state = window[NS] || (window[NS] = { sessionId: null });

  function ensureSessionId() {
    if (state.sessionId) return state.sessionId;
    try {
      const key = 'hoppa_forms_sid';
      const existing = window.localStorage.getItem(key);
      if (existing) {
        state.sessionId = existing;
        return existing;
      }
      const next = 'fs_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      window.localStorage.setItem(key, next);
      state.sessionId = next;
      return next;
    } catch {
      const fallback = 'fs_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      state.sessionId = fallback;
      return fallback;
    }
  }

  function comparableValue(value) {
    if (Array.isArray(value)) return value.map((v) => String(v));
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value).trim();
  }

  function conditionPasses(condition, answers) {
    const left = answers[condition.fieldId];
    const right = condition.value;
    switch (condition.operator) {
      case 'is_truthy':
        if (Array.isArray(left)) return left.length > 0;
        if (typeof left === 'string') return left.trim().length > 0;
        return !!left;
      case 'is_falsy':
        if (Array.isArray(left)) return left.length === 0;
        if (typeof left === 'string') return left.trim().length === 0;
        return !left;
      case 'includes': {
        const l = comparableValue(left);
        if (Array.isArray(l)) return l.includes(String(right ?? ''));
        return l.includes(String(right ?? ''));
      }
      case 'not_equals':
        return String(comparableValue(left)) !== String(comparableValue(right));
      case 'equals':
      default:
        return String(comparableValue(left)) === String(comparableValue(right));
    }
  }

  function conditionsPass(conditions, answers) {
    if (!Array.isArray(conditions) || conditions.length === 0) return false;
    return conditions.every((c) => conditionPasses(c, answers));
  }

  const script = document.currentScript;
  if (!script) return;
  const token = script.getAttribute('data-hoppa-form-token');
  if (!token) return;

  const src = script.getAttribute('src') || '';
  const apiOrigin = new URL(src, window.location.href).origin;
  const renderUrl = apiOrigin + '/api/f/render/' + encodeURIComponent(token);
  const eventUrl = apiOrigin + '/api/f/events/' + encodeURIComponent(token);
  const submitUrl = apiOrigin + '/api/f/submit/' + encodeURIComponent(token);

  let root = null;
  const selector = script.getAttribute('data-hoppa-form-target');
  if (selector) root = document.querySelector(selector);
  if (!root) {
    const prev = script.previousElementSibling;
    if (prev && prev.hasAttribute('data-hoppa-form-root')) root = prev;
  }
  if (!root) {
    root = document.createElement('div');
    root.setAttribute('data-hoppa-form-root', '');
    script.parentNode && script.parentNode.insertBefore(root, script);
  }

  function postJson(url, payload) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      mode: 'cors',
    });
  }

  function sendEvent(type) {
    const payload = { sessionId: ensureSessionId(), type, path: window.location.href };
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(eventUrl, blob);
      return;
    }
    void postJson(eventUrl, payload);
  }

  function injectStyles() {
    if (document.getElementById('hf-styles-v2')) return;
    const style = document.createElement('style');
    style.id = 'hf-styles-v2';
    style.textContent = [
      '.hf-card{font-family:inherit;color:inherit;border:1px solid rgba(15,23,42,.15);border-radius:14px;padding:16px;background:transparent;}',
      '.hf-title{font-size:1.2rem;font-weight:700;margin:0 0 4px;}',
      '.hf-desc{opacity:.8;margin:0 0 12px;font-size:.95rem;}',
      '.hf-grid{display:grid;gap:10px;}',
      '.hf-field{display:grid;gap:6px;}',
      '.hf-label{font-size:.85rem;font-weight:600;}',
      '.hf-error{font-size:.78rem;color:#b91c1c;min-height:1em;}',
      '.hf-input,.hf-textarea,.hf-select{width:100%;border:1px solid rgba(15,23,42,.22);border-radius:10px;padding:10px;background:transparent;color:inherit;font:inherit;}',
      '.hf-textarea{min-height:110px;resize:vertical;}',
      '.hf-inline{display:flex;flex-wrap:wrap;gap:10px;}',
      '.hf-check{display:inline-flex;align-items:center;gap:6px;font-size:.92rem;}',
      '.hf-submit{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:10px;padding:10px 14px;background:#0f172a;color:#fff;font-weight:700;cursor:pointer;}',
      '.hf-submit[disabled]{opacity:.55;cursor:not-allowed;}',
      '.hf-ok{font-size:.9rem;color:#166534;min-height:1.2em;}',
      '.hf-captcha{margin-top:6px;}',
    ].join('');
    document.head.appendChild(style);
  }

  function readAnswers(formEl, fields) {
    const out = {};
    fields.forEach((field) => {
      if (field.type === 'radio') {
        const selected = formEl.querySelector('input[name="' + field.id + '"]:checked');
        out[field.id] = selected ? selected.value : '';
        return;
      }
      if (field.type === 'checkbox') {
        const checks = Array.from(formEl.querySelectorAll('input[name="' + field.id + '"]'));
        if ((field.options || []).length > 0) {
          out[field.id] = checks.filter((n) => n.checked).map((n) => n.value);
        } else {
          out[field.id] = checks[0] ? checks[0].checked : false;
        }
        return;
      }
      const node = formEl.querySelector('[name="' + field.id + '"]');
      out[field.id] = node ? node.value : '';
    });
    return out;
  }

  function clearErrors(errorNodes) {
    Object.keys(errorNodes).forEach((k) => {
      errorNodes[k].textContent = '';
    });
  }

  function loadCaptcha(provider, siteKey, mount, onToken) {
    if (!provider || !siteKey || !mount) return Promise.resolve(null);
    if (provider === 'hcaptcha') {
      return new Promise((resolve) => {
        const ensure = () => {
          if (!window.hcaptcha || !window.hcaptcha.render) {
            setTimeout(ensure, 50);
            return;
          }
          const id = window.hcaptcha.render(mount, {
            sitekey: siteKey,
            callback: onToken,
            'expired-callback': () => onToken(''),
          });
          resolve({ reset: () => window.hcaptcha && window.hcaptcha.reset(id) });
        };
        const s = document.createElement('script');
        s.src = 'https://js.hcaptcha.com/1/api.js?render=explicit';
        s.async = true;
        s.defer = true;
        s.onload = ensure;
        document.head.appendChild(s);
      });
    }
    return new Promise((resolve) => {
      const ensure = () => {
        if (!window.grecaptcha || !window.grecaptcha.render) {
          setTimeout(ensure, 50);
          return;
        }
        const id = window.grecaptcha.render(mount, {
          sitekey: siteKey,
          callback: onToken,
          'expired-callback': () => onToken(''),
        });
        resolve({ reset: () => window.grecaptcha && window.grecaptcha.reset(id) });
      };
      const s = document.createElement('script');
      s.src = 'https://www.google.com/recaptcha/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      s.onload = ensure;
      document.head.appendChild(s);
    });
  }

  injectStyles();

  fetch(renderUrl, { mode: 'cors' })
    .then((r) => {
      if (!r.ok) throw new Error('render_failed');
      return r.json();
    })
    .then(async (payload) => {
      if (!payload || !payload.definition || !Array.isArray(payload.definition.fields)) {
        throw new Error('invalid_payload');
      }

      const card = document.createElement('div');
      card.className = 'hf-card';

      if (payload.definition.title && payload.definition.title.trim()) {
        const title = document.createElement('h3');
        title.className = 'hf-title';
        title.textContent = payload.definition.title;
        card.appendChild(title);
      }

      if (payload.definition.description) {
        const desc = document.createElement('p');
        desc.className = 'hf-desc';
        desc.textContent = payload.definition.description;
        card.appendChild(desc);
      }

      const formEl = document.createElement('form');
      formEl.className = 'hf-grid';
      const errorNodes = {};
      const wrappers = {};
      const labels = {};
      const fields = payload.definition.fields;

      fields.forEach((field) => {
        const wrap = document.createElement('div');
        wrap.className = 'hf-field';
        const label = document.createElement('div');
        label.className = 'hf-label';
        label.textContent = field.label;
        wrap.appendChild(label);

        const addInput = (node) => wrap.appendChild(node);

        if (field.type === 'textarea') {
          const el = document.createElement('textarea');
          el.className = 'hf-textarea';
          el.name = field.id;
          el.placeholder = field.placeholder || '';
          addInput(el);
        } else if (field.type === 'select') {
          const el = document.createElement('select');
          el.className = 'hf-select';
          el.name = field.id;
          const empty = document.createElement('option');
          empty.value = '';
          empty.textContent = 'Select...';
          el.appendChild(empty);
          (field.options || []).forEach((opt) => {
            const o = document.createElement('option');
            o.value = opt.value;
            o.textContent = opt.label;
            el.appendChild(o);
          });
          addInput(el);
        } else if (field.type === 'radio') {
          const row = document.createElement('div');
          row.className = 'hf-inline';
          (field.options || []).forEach((opt) => {
            const l = document.createElement('label');
            l.className = 'hf-check';
            const i = document.createElement('input');
            i.type = 'radio';
            i.name = field.id;
            i.value = opt.value;
            l.appendChild(i);
            l.appendChild(document.createTextNode(opt.label));
            row.appendChild(l);
          });
          addInput(row);
        } else if (field.type === 'checkbox' && (field.options || []).length > 0) {
          const grid = document.createElement('div');
          grid.className = 'hf-grid';
          (field.options || []).forEach((opt) => {
            const l = document.createElement('label');
            l.className = 'hf-check';
            const i = document.createElement('input');
            i.type = 'checkbox';
            i.name = field.id;
            i.value = opt.value;
            l.appendChild(i);
            l.appendChild(document.createTextNode(opt.label));
            grid.appendChild(l);
          });
          addInput(grid);
        } else if (field.type === 'checkbox') {
          const l = document.createElement('label');
          l.className = 'hf-check';
          const i = document.createElement('input');
          i.type = 'checkbox';
          i.name = field.id;
          l.appendChild(i);
          l.appendChild(document.createTextNode(field.helpText || 'Check to confirm'));
          addInput(l);
        } else {
          const el = document.createElement('input');
          el.className = 'hf-input';
          el.type = field.type === 'email' ? 'email' : field.type === 'number' ? 'number' : 'text';
          el.name = field.id;
          el.placeholder = field.placeholder || '';
          addInput(el);
        }

        if (field.helpText && field.type !== 'checkbox') {
          const h = document.createElement('div');
          h.style.fontSize = '.78rem';
          h.style.opacity = '.75';
          h.textContent = field.helpText;
          wrap.appendChild(h);
        }

        const err = document.createElement('div');
        err.className = 'hf-error';
        wrap.appendChild(err);
        errorNodes[field.id] = err;
        wrappers[field.id] = wrap;
        labels[field.id] = label;
        formEl.appendChild(wrap);
      });

      const honeyName = (payload.security && payload.security.honeypotFieldName) || 'company_website';
      const honey = document.createElement('input');
      honey.type = 'text';
      honey.name = honeyName;
      honey.tabIndex = -1;
      honey.autocomplete = 'off';
      honey.style.position = 'absolute';
      honey.style.left = '-10000px';
      honey.style.opacity = '0';
      formEl.appendChild(honey);

      const captchaMount = document.createElement('div');
      captchaMount.className = 'hf-captcha';
      let captchaToken = '';
      let captchaApi = null;
      if (payload.security && payload.security.captchaProvider && payload.security.captchaSiteKey) {
        formEl.appendChild(captchaMount);
        captchaApi = await loadCaptcha(payload.security.captchaProvider, payload.security.captchaSiteKey, captchaMount, (tokenValue) => {
          captchaToken = tokenValue || '';
        });
      }

      const ok = document.createElement('div');
      ok.className = 'hf-ok';
      formEl.appendChild(ok);

      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.className = 'hf-submit';
      submit.textContent = payload.definition.submitLabel || 'Submit';
      formEl.appendChild(submit);

      function applyRules() {
        const answers = readAnswers(formEl, fields);
        fields.forEach((field) => {
          const show = !field.showWhen || field.showWhen.length === 0 || conditionsPass(field.showWhen, answers);
          const required = !!field.required || (!!field.requiredWhen && field.requiredWhen.length > 0 && conditionsPass(field.requiredWhen, answers));
          wrappers[field.id].style.display = show ? '' : 'none';
          labels[field.id].textContent = field.label + (required ? ' *' : '');
        });
      }

      let interacted = false;
      formEl.addEventListener('input', () => {
        if (!interacted) {
          interacted = true;
          sendEvent('interact');
        }
        applyRules();
      });

      formEl.addEventListener('submit', (ev) => {
        ev.preventDefault();
        clearErrors(errorNodes);
        ok.textContent = '';
        submit.disabled = true;

        const answers = readAnswers(formEl, fields);
        postJson(submitUrl, {
          sessionId: ensureSessionId(),
          answers,
          captchaToken,
          honey: honey.value,
        })
          .then((r) => r.json())
          .then((result) => {
            if (result && result.ok) {
              ok.textContent = result.message || 'Submitted successfully.';
              formEl.reset();
              captchaToken = '';
              if (captchaApi && captchaApi.reset) captchaApi.reset();
              applyRules();
              return;
            }
            const errs = result && result.errors ? result.errors : {};
            Object.keys(errs).forEach((k) => {
              if (errorNodes[k]) errorNodes[k].textContent = String(errs[k]);
            });
            if (errs.__form) ok.textContent = String(errs.__form);
          })
          .catch(() => {
            ok.textContent = 'Could not submit. Please try again.';
          })
          .finally(() => {
            submit.disabled = false;
          });
      });

      card.appendChild(formEl);
      root.innerHTML = '';
      root.appendChild(card);
      applyRules();
      sendEvent('view');
    })
    .catch(() => {
      root.innerHTML = '<div style="font-family:inherit;border:1px solid #e5e7eb;border-radius:10px;padding:12px;">Unable to load form.</div>';
    });
})();`;

formsPublicRouter.get('/embed.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(EMBED_JS);
});

formsPublicRouter.get('/render/:token', rateLimit({ key: 'forms-render', max: 240, windowSec: 60 }), async (req, res, next) => {
  try {
    const origin = (req.headers.origin ?? null) as string | null;
    const referer = (req.headers.referer ?? req.headers.referrer ?? null) as string | null;
    res.json(await formsSvc.getPublicForm({ token: req.params.token!, ctx: { origin, referer } }));
  } catch (e) {
    next(e);
  }
});

formsPublicRouter.post(
  '/events/:token',
  rateLimit({ key: 'forms-events', max: 600, windowSec: 60 }),
  validate(TrackFormEventSchema),
  async (req, res, next) => {
    try {
      const input = getValidated<typeof TrackFormEventSchema._type>(req);
      const origin = (req.headers.origin ?? null) as string | null;
      const ip = (req.ip ?? req.socket.remoteAddress ?? null) || null;
      const userAgent = req.headers['user-agent'] ?? null;
      const referer = (req.headers.referer ?? req.headers.referrer ?? null) as string | null;
      await formsSvc.recordPublicEvent({
        token: req.params.token!,
        input,
        origin,
        ip,
        userAgent,
        referer,
      });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

formsPublicRouter.post(
  '/submit/:token',
  rateLimit({ key: 'forms-submit', max: 120, windowSec: 60 }),
  validate(PublicFormSubmitSchema),
  async (req, res, next) => {
    try {
      const input = getValidated<typeof PublicFormSubmitSchema._type>(req);
      const origin = (req.headers.origin ?? null) as string | null;
      const ip = (req.ip ?? req.socket.remoteAddress ?? null) || null;
      const userAgent = req.headers['user-agent'] ?? null;
      const referer = (req.headers.referer ?? req.headers.referrer ?? null) as string | null;
      const result = await formsSvc.submitPublicForm({
        token: req.params.token!,
        input,
        origin,
        ip,
        userAgent,
        referer,
      });
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    } catch (e) {
      next(e);
    }
  },
);
