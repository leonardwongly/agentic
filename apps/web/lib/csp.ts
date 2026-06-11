type BuildContentSecurityPolicyOptions = {
  isDevelopment: boolean;
};

// Static (nonce-free) Content-Security-Policy.
//
// Previously this policy generated a per-request nonce in Node middleware
// (`proxy.ts`) and used `'strict-dynamic'`. The Cloudflare Workers target
// (`@opennextjs/cloudflare`) cannot run Next.js 16 Node middleware, and a
// per-request nonce cannot be produced without it. We therefore ship a static
// policy applied via `next.config.ts` `headers()`, which works identically on
// the Node and Workers targets.
//
// Tradeoff (tracked in F7 / issue #984): inline scripts and styles emitted by
// Next.js are permitted via `'unsafe-inline'` instead of a nonce. All other
// strict directives (`default-src`, `object-src`, `base-uri`, `form-action`,
// `frame-ancestors`) are retained, so clickjacking, base-tag, form-hijacking,
// and plugin vectors stay closed.
export function buildContentSecurityPolicy({ isDevelopment }: BuildContentSecurityPolicyOptions): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests"
  ];

  return directives.join("; ");
}
