export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Safely embed JSON inside a <script> tag. */
export function jsonScript(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');
}

export function layout(ctx, { title, description, canonical, image, body, bodyClass = '', head = '', scripts = '', noindex = false }) {
  const { config, asset } = ctx;
  const ogImage = image ? new URL(image, config.siteUrl).toString() : `${config.siteUrl}/images/og-default.jpg`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#2b2e2f" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f4f7f7" media="(prefers-color-scheme: light)">
<meta property="og:site_name" content="${esc(config.siteName)}">
<meta property="og:locale" content="en_US">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title.replace(/ – NOLA\.Today$/, ''))}">
<meta property="og:description" content="${esc(description)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
<meta property="og:image" content="${esc(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${asset('/favicon.ico')}" sizes="any">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;500;600;700&family=Orelega+One&display=swap">
<link rel="stylesheet" href="${asset('/assets/styles.css')}">
${head}
</head>
<body class="${bodyClass}">
${body}
<script src="${asset('/assets/site.js')}" defer></script>
${scripts}
${config.fathomSite ? `<script src="https://cdn.usefathom.com/script.js" data-site="${esc(config.fathomSite)}" defer></script>` : ''}
</body>
</html>
`;
}

export function siteHeader(ctx, { current } = {}) {
  const { url } = ctx;
  const link = (href, label, key) =>
    `<a href="${url(href)}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<header class="site-header">
  <a class="brand" href="${url('/')}">NOLA.Today</a>
  <nav class="site-nav" aria-label="Main">
    ${link('/', 'Map', 'map')}
    ${link('/venues', 'Venues', 'venues')}
    ${link('/parades', 'Parades', 'parades')}
  </nav>
</header>`;
}

export function siteFooter(ctx) {
  const { url } = ctx;
  return `<footer class="site-footer">
  <div class="wrap footer-inner">
    <div>
      <a class="brand" href="${url('/')}">NOLA.Today</a>
      <p class="muted">Mapping live music in New Orleans. Schedules are gathered automatically from venue websites and ticketing pages — always confirm with the venue before heading out.</p>
      <p class="muted">Parade routes and times come from <a href="${url('/parades')}#sources">City of New Orleans records</a>, offered for general information only.</p>
    </div>
    <p class="colophon">NOLA.Today is an
      <a href="https://github.com/nolastan/nolatoday">open source</a> project by <a href="https://stanfordrosenthal.com">Stanford Rosenthal</a>.
      <a href="${url('/contact')}">Contact</a> · <a href="${url('/privacy')}">Privacy</a>
    </p>
  </div>
</footer>`;
}
