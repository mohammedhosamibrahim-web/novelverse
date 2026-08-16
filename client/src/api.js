/**
 * API client: same-origin fetch wrapper.
 * - JWT rides in an httpOnly cookie automatically.
 * - CSRF double-submit: every state-changing request echoes the `csrf`
 *   cookie value in the X-CSRF-Token header (fetched on demand).
 */
function csrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
  return m ? m[1] : '';
}

async function ensureCsrf() {
  if (csrfToken()) return;
  try {
    await fetch('/api/auth/csrf', { credentials: 'same-origin' });
  } catch {
    /* offline */
  }
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const stateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  if (stateChanging) await ensureCsrf();
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (stateChanging) headers['X-CSRF-Token'] = csrfToken();

  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });

  // CSRF token can rotate (e.g. after login) — refresh once and retry.
  if (res.status === 403 && stateChanging) {
    const data0 = await res.json().catch(() => null);
    if (data0 && data0.code === 'CSRF_FAILED') {
      await ensureCsrf();
      headers['X-CSRF-Token'] = csrfToken();
      const retry = await fetch('/api' + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
      });
      const retryData = await retry.json().catch(() => null);
      if (!retry.ok) throw new ApiError((retryData && retryData.error) || retry.statusText, retry.status, retryData);
      return retryData;
    }
    throw new ApiError((data0 && data0.error) || res.statusText, res.status, data0);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError((data && data.error) || res.statusText, res.status, data);
  }
  return data;
}
