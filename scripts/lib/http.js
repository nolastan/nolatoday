const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 (compatible; NOLA.Today event bot; +https://nola.today)';

export class HttpError extends Error {
  constructor(url, status, body = '') {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
    this.url = url;
    this.status = status;
    this.body = body.slice(0, 500);
  }
}

/**
 * fetch() with a browser-ish user agent, a timeout and a couple of retries for
 * transient failures. Throws HttpError on non-2xx responses.
 */
export async function request(url, { headers = {}, timeout = 30000, retries = 2, method = 'GET', body } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        body,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/json,text/calendar,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          ...headers,
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new HttpError(url, res.status, text);
        // 4xx (other than 429) won't fix themselves on retry.
        if (res.status < 500 && res.status !== 429) throw err;
        lastError = err;
      } else {
        return res;
      }
    } catch (err) {
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
      lastError = err;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw lastError;
}

export async function fetchText(url, options) {
  const res = await request(url, options);
  return res.text();
}

export async function fetchJSON(url, options = {}) {
  const res = await request(url, { ...options, headers: { accept: 'application/json', ...options.headers } });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${url} but got: ${text.slice(0, 120)}`);
  }
}
