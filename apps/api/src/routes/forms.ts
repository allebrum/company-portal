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

// Status the form settings UI warns about: is the workspace system sender
// connected (notification email), which captcha keys exist server-side.
formsRouter.get('/config', requirePermission('forms.view'), async (_req, res, next) => {
  try {
    res.json(await formsSvc.getFormsConfig());
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
    if (document.getElementById('hf-styles-v3')) return;
    const style = document.createElement('style');
    style.id = 'hf-styles-v3';
    style.textContent = [
      '.hf-card,.hoppa-form-card{font-family:inherit;color:inherit;border:1px solid rgba(15,23,42,.15);border-radius:14px;padding:16px;background:transparent;}',
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
      '.hf-ok.is-error{color:#b91c1c;}',
      '.hf-captcha{margin-top:6px;}',
      '.hoppa-form-success{display:none;text-align:center;padding:8px 4px 2px;outline:none;}',
      '.hoppa-form-success[data-open="1"]{display:block;}',
      '.hoppa-form-success-icon{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:999px;background:rgba(22,101,52,.12);color:#166534;margin:0 auto 12px;}',
      '.hoppa-form-success-icon svg{width:28px;height:28px;display:block;}',
      '.hoppa-form-success-message{font-size:1.05rem;font-weight:650;line-height:1.45;margin:0 0 14px;color:inherit;}',
      '.hoppa-form-reset{background:none;border:0;padding:0;font:inherit;font-size:.9rem;color:inherit;opacity:.8;text-decoration:underline;cursor:pointer;}',
      '.hoppa-form-reset:hover,.hoppa-form-reset:focus{opacity:1;}',
      '.hoppa-form-body[hidden],.hoppa-form[hidden],.hoppa-form-success[hidden],.hoppa-form-reset[hidden]{display:none !important;}',
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


  function digitsOnly(value) {
    return String(value || '').replace(/\D+/g, '');
  }
  function formatPhoneUS(raw) {
    let d = digitsOnly(raw);
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    d = d.slice(0, 10);
    if (d.length === 0) return '';
    if (d.length < 4) return '(' + d;
    if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
    return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
  }
  function phoneFormatOf(field) {
    return (field.validation && field.validation.phoneFormat) || 'us';
  }
  function inputTypeOf(type) {
    if (type === 'email') return 'email';
    if (type === 'phone') return 'tel';
    if (type === 'url') return 'url';
    if (type === 'date') return 'date';
    if (type === 'number') return 'number';
    return 'text';
  }
  function inputModeOf(type) {
    if (type === 'email') return 'email';
    if (type === 'phone') return 'tel';
    if (type === 'url') return 'url';
    if (type === 'number') return 'decimal';
    return '';
  }
  function autocompleteOf(field) {
    if (field.autocomplete) return field.autocomplete;
    if (field.type === 'email') return 'email';
    if (field.type === 'phone') return 'tel';
    if (field.type === 'url') return 'url';
    return '';
  }
  function isValidIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parts = value.split('-').map(Number);
    const y = parts[0], m = parts[1], d = parts[2];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  function validateClientField(field, raw) {
    const v = field.validation || {};
    if (field.type === 'number') {
      if (raw === undefined || raw === null || raw === '') return null;
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!isFinite(n)) return 'Please enter a valid number.';
      if (typeof v.min === 'number' && n < v.min) return 'Must be at least ' + v.min + '.';
      if (typeof v.max === 'number' && n > v.max) return 'Must be at most ' + v.max + '.';
      if (typeof v.step === 'number' && v.step > 0) {
        const base = typeof v.min === 'number' ? v.min : 0;
        const steps = (n - base) / v.step;
        if (Math.abs(steps - Math.round(steps)) > 1e-8) return 'Must be a multiple of ' + v.step + '.';
      }
      return null;
    }
    const str = String(raw == null ? '' : raw).trim();
    if (!str) return null;
    if (field.type === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) return 'Please enter a valid email address.';
      return null;
    }
    if (field.type === 'phone') {
      const fmt = phoneFormatOf(field);
      let d = digitsOnly(str);
      if (fmt === 'us') {
        if (d.length === 11 && d[0] === '1') d = d.slice(1);
        if (d.length !== 10) return 'Enter a 10-digit US phone number.';
        return null;
      }
      if (fmt === 'e164') {
        let compact = str.trim().replace(/[\s()-]/g, '');
        if (compact[0] !== '+') compact = d.length === 10 ? '+1' + d : '+' + d;
        if (compact.indexOf('00') === 0) compact = '+' + compact.slice(2);
        if (!/^\+[1-9]\d{7,14}$/.test(compact)) return 'Enter a phone number in E.164 format, like +14155552671.';
        return null;
      }
      if (d.length < 8 || d.length > 15) return 'Enter a valid phone number (8–15 digits).';
      return null;
    }
    if (field.type === 'url') {
      try {
        const u = new URL(str);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Enter a URL starting with http:// or https://.';
      } catch (err) {
        return 'Enter a valid URL, like https://example.com.';
      }
      return null;
    }
    if (field.type === 'date') {
      if (!isValidIsoDate(str)) return 'Enter a valid date.';
      if (v.minDate && str < v.minDate) return 'Date must be on or after ' + v.minDate + '.';
      if (v.maxDate && str > v.maxDate) return 'Date must be on or before ' + v.maxDate + '.';
      return null;
    }
    if (typeof v.minLength === 'number' && str.length < v.minLength) return 'Must be at least ' + v.minLength + ' characters.';
    if (typeof v.maxLength === 'number' && str.length > v.maxLength) return 'Must be at most ' + v.maxLength + ' characters.';
    return null;
  }
  function clientErrors(fields, answers) {
    const errors = {};
    fields.forEach((field) => {
      if (field.showWhen && field.showWhen.length > 0 && !conditionsPass(field.showWhen, answers)) return;
      const required = !!field.required || (!!field.requiredWhen && field.requiredWhen.length > 0 && conditionsPass(field.requiredWhen, answers));
      const raw = answers[field.id];
      if (field.type === 'checkbox' && (field.options || []).length > 0) {
        const arr = Array.isArray(raw) ? raw : [];
        if (required && arr.length === 0) errors[field.id] = 'Please select at least one option.';
        return;
      }
      if (field.type === 'checkbox') {
        if (required && !raw) errors[field.id] = 'This checkbox is required.';
        return;
      }
      if (field.type === 'number') {
        if ((raw === '' || raw == null) && required) {
          errors[field.id] = 'This field is required.';
          return;
        }
        const err = validateClientField(field, raw);
        if (err) errors[field.id] = err;
        return;
      }
      const str = String(raw == null ? '' : raw).trim();
      if (!str) {
        if (required) errors[field.id] = 'This field is required.';
        return;
      }
      const err = validateClientField(field, raw);
      if (err) errors[field.id] = err;
    });
    return errors;
  }

  function clearErrors(errorNodes) {
    Object.keys(errorNodes).forEach((k) => {
      errorNodes[k].textContent = '';
    });
  }

  function loadCaptcha(provider, siteKey, mount, onToken) {
    if (!provider || !siteKey || !mount) return Promise.resolve(null);
    if (provider === 'turnstile') {
      // Cloudflare Turnstile renders on THIS page, so the host page's domain
      // must be in the widget's hostname allowlist in Cloudflare.
      return new Promise((resolve) => {
        const ensure = () => {
          if (!window.turnstile || !window.turnstile.render) {
            setTimeout(ensure, 50);
            return;
          }
          const id = window.turnstile.render(mount, {
            sitekey: siteKey,
            callback: onToken,
            'expired-callback': () => onToken(''),
            'error-callback': () => onToken(''),
          });
          resolve({ reset: () => window.turnstile && window.turnstile.reset(id) });
        };
        if (window.turnstile && window.turnstile.render) {
          ensure();
          return;
        }
        if (!document.querySelector('script[data-hoppa-turnstile]')) {
          const s = document.createElement('script');
          s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
          s.async = true;
          s.defer = true;
          s.setAttribute('data-hoppa-turnstile', '1');
          document.head.appendChild(s);
        }
        ensure();
      });
    }
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
      card.className = 'hf-card hoppa-form-card';

      const body = document.createElement('div');
      body.className = 'hoppa-form-body';

      if (payload.definition.title && payload.definition.title.trim()) {
        const title = document.createElement('h3');
        title.className = 'hf-title';
        title.textContent = payload.definition.title;
        body.appendChild(title);
      }

      if (payload.definition.description) {
        const desc = document.createElement('p');
        desc.className = 'hf-desc';
        desc.textContent = payload.definition.description;
        body.appendChild(desc);
      }

      const formEl = document.createElement('form');
      formEl.className = 'hf-grid hoppa-form';
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
          const ac = autocompleteOf(field);
          if (ac) el.setAttribute('autocomplete', ac);
          if (field.validation && typeof field.validation.maxLength === 'number') el.maxLength = field.validation.maxLength;
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
          el.type = inputTypeOf(field.type);
          el.name = field.id;
          el.placeholder = field.placeholder || '';
          const mode = inputModeOf(field.type);
          if (mode) el.setAttribute('inputmode', mode);
          const ac = autocompleteOf(field);
          if (ac) el.setAttribute('autocomplete', ac);
          const v = field.validation || {};
          if (field.type === 'number') {
            if (typeof v.min === 'number') el.min = String(v.min);
            if (typeof v.max === 'number') el.max = String(v.max);
            if (typeof v.step === 'number') el.step = String(v.step);
          }
          if (field.type === 'date') {
            if (v.minDate) el.min = v.minDate;
            if (v.maxDate) el.max = v.maxDate;
          }
          if (typeof v.maxLength === 'number') el.maxLength = v.maxLength;
          if (field.type === 'phone' && phoneFormatOf(field) === 'us') {
            el.addEventListener('input', () => {
              const next = formatPhoneUS(el.value);
              if (next !== el.value) el.value = next;
            });
          }
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

      const allowMore = payload.definition.allowAnotherSubmission !== false;
      const resetLabel = payload.definition.resetLabel || 'Submit another response';
      const redirectUrl = payload.definition.redirectUrl || '';
      const doneKey = 'hoppa_form_done_' + token;

      function isSafeHttpUrl(value) {
        try {
          const u = new URL(value);
          return u.protocol === 'http:' || u.protocol === 'https:';
        } catch (err) {
          return false;
        }
      }

      const success = document.createElement('div');
      success.className = 'hoppa-form-success';
      success.setAttribute('role', 'status');
      success.setAttribute('aria-live', 'polite');
      success.tabIndex = -1;
      success.hidden = true;

      const successIcon = document.createElement('div');
      successIcon.className = 'hoppa-form-success-icon';
      successIcon.setAttribute('aria-hidden', 'true');
      successIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 12.5l2.5 2.5L16 9.5"></path></svg>';
      success.appendChild(successIcon);

      const successMsg = document.createElement('p');
      successMsg.className = 'hoppa-form-success-message';
      success.appendChild(successMsg);

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'hoppa-form-reset';
      resetBtn.textContent = resetLabel;
      if (!allowMore) resetBtn.hidden = true;
      success.appendChild(resetBtn);

      function rememberDone(message) {
        if (allowMore) return;
        try {
          window.localStorage.setItem(doneKey, JSON.stringify({ message: message || '', at: Date.now() }));
        } catch (err) {}
      }

      function readDoneMessage() {
        if (allowMore) return null;
        try {
          const raw = window.localStorage.getItem(doneKey);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.message === 'string') return parsed.message;
          return null;
        } catch (err) {
          return null;
        }
      }

      function showSuccess(message, fromStorage) {
        const text = message || payload.definition.successMessage || 'Thanks, we got your submission.';
        if (!fromStorage && isSafeHttpUrl(redirectUrl)) {
          rememberDone(text);
          try {
            if (window.top) window.top.location.href = redirectUrl;
            else window.location.href = redirectUrl;
          } catch (err) {
            window.location.href = redirectUrl;
          }
          return;
        }
        rememberDone(text);
        body.hidden = true;
        success.hidden = false;
        success.setAttribute('data-open', '1');
        successMsg.textContent = text;
        try { success.focus(); } catch (err) {}
      }

      function restoreForm() {
        try { window.localStorage.removeItem(doneKey); } catch (err) {}
        success.hidden = true;
        success.removeAttribute('data-open');
        successMsg.textContent = '';
        body.hidden = false;
        formEl.reset();
        captchaToken = '';
        ok.textContent = '';
        ok.classList.remove('is-error');
        clearErrors(errorNodes);
        if (captchaApi && captchaApi.reset) captchaApi.reset();
        applyRules();
        submit.disabled = false;
        const first = formEl.querySelector('input,select,textarea,button');
        if (first && first.focus) try { first.focus(); } catch (err) {}
      }

      resetBtn.addEventListener('click', restoreForm);

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
        ok.classList.remove('is-error');
        submit.disabled = true;

        const answers = readAnswers(formEl, fields);
        const localErrors = clientErrors(fields, answers);
        if (Object.keys(localErrors).length > 0) {
          Object.keys(localErrors).forEach((k) => {
            if (errorNodes[k]) errorNodes[k].textContent = String(localErrors[k]);
          });
          submit.disabled = false;
          return;
        }
        postJson(submitUrl, {
          sessionId: ensureSessionId(),
          answers,
          captchaToken,
          honey: honey.value,
        })
          .then((r) => r.json().then((body) => ({ status: r.status, body })).catch(() => ({ status: r.status, body: null })))
          .then((res) => {
            const result = res.body;
            if (result && result.ok) {
              showSuccess(result.message || 'Submitted successfully.', false);
              return;
            }
            const errs = result && result.errors ? result.errors : {};
            Object.keys(errs).forEach((k) => {
              if (errorNodes[k]) errorNodes[k].textContent = String(errs[k]);
            });
            if (errs.__form) {
              ok.textContent = String(errs.__form);
              ok.classList.add('is-error');
            } else if (res.status === 429 || (result && result.error === 'rate_limited')) {
              ok.textContent = 'Too many submissions. Please try again later.';
              ok.classList.add('is-error');
            }
          })
          .catch(() => {
            ok.textContent = 'Could not submit. Please try again.';
            ok.classList.add('is-error');
          })
          .finally(() => {
            if (!success.getAttribute('data-open')) submit.disabled = false;
          });
      });

      body.appendChild(formEl);
      card.appendChild(body);
      card.appendChild(success);
      root.innerHTML = '';
      root.appendChild(card);
      applyRules();
      const remembered = readDoneMessage();
      if (remembered !== null) {
        showSuccess(remembered || payload.definition.successMessage || 'Thanks, we got your submission.', true);
      }
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
        res.status(result.status ?? 400).json(result);
        return;
      }
      res.json(result);
    } catch (e) {
      next(e);
    }
  },
);
