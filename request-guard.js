import { randomBytes, timingSafeEqual } from 'node:crypto';

const loopbackHost = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i;
export function createRequestGuard() {
  const key = randomBytes(32).toString('hex');
  const validKey = value => {
    if (typeof value !== 'string') return false;
    const bytes = Buffer.from(value);
    return bytes.length === 64 && timingSafeEqual(bytes, Buffer.from(key));
  };
  function source(req) {
    const host = req.headers.host;
    if (typeof host !== 'string' || !loopbackHost.test(host)) return 'rejected';
    const origin = req.headers.origin;
    if (!origin) return 'desktop-proxy';
    if (origin === 'dsh-app://app') return 'desktop-proxy';
    try {
      const url = new URL(origin);
      return url.protocol === 'http:' && url.host.toLowerCase() === host.toLowerCase() ? 'same-origin' : 'rejected';
    } catch { return 'rejected'; }
  }
  return {
    session: () => ({ writeToken: key }),
    allowsRead: req => source(req) !== 'rejected',
    allowsWrite(req, input) {
      const from = source(req);
      if (from === 'rejected') return false;
      if (from === 'same-origin') return true;
      return validKey(req.headers['x-travel-client-key']) || validKey(input?.clientToken);
    },
  };
}
