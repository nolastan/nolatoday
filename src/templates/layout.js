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

export function layout(ctx, { title, description, canonical, image, imageAlt, body, bodyClass = '', head = '', scripts = '', noindex = false }) {
  const { config, asset } = ctx;
  const ogImage = image ? new URL(image, config.siteUrl).toString() : `${config.siteUrl}/images/og-default.jpg`;
  const ogTitle = title.replace(/ – NOLA\.Today$/, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
${noindex ? '<meta name="robots" content="noindex">' : ''}
${config.appStoreId ? `<meta name="apple-itunes-app" content="app-id=${esc(config.appStoreId)}">` : ''}
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#2b2e2f" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f4f7f7" media="(prefers-color-scheme: light)">
<meta property="og:site_name" content="${esc(config.siteName)}">
<meta property="og:locale" content="en_US">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(description)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
<meta property="og:image" content="${esc(ogImage)}">
${image ? '' : '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">'}
<meta property="og:image:alt" content="${esc(imageAlt ?? ogTitle)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(ogImage)}">
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
    ${link('/artists', 'Artists', 'artists')}
    ${link('/parades', 'Parades', 'parades')}
    ${link('/food', 'Food', 'food')}
  </nav>
</header>`;
}

export function appStoreUrl(config) {
  return config.appStoreId ? `https://apps.apple.com/app/id${encodeURIComponent(config.appStoreId)}` : null;
}

export function siteFooter(ctx) {
  const { url, config, asset } = ctx;
  const appUrl = appStoreUrl(config);
  return `<footer class="site-footer">
  <div class="wrap footer-inner">
    <div>
      <a class="brand" href="${url('/')}">NOLA.Today</a>
      <p class="muted">Mapping live music in New Orleans. Schedules are gathered automatically from venue websites and ticketing pages — always confirm with the venue before heading out.</p>
      <p class="muted">Parade routes and times come from <a href="${url('/parades')}#sources">City of New Orleans records</a>, offered for general information only, with a few dates from organizers’ own websites.</p>
    </div>
    <div class="footer-side">
      ${appUrl ? `<a class="app-badge" href="${esc(appUrl)}"><img src="${asset('/images/app-store-badge.svg')}" width="120" height="40" alt="Download on the App Store"></a>` : ''}
      <p class="colophon">NOLA.Today is an
        <a href="https://github.com/nolastan/nolatoday">open source</a> project by <a href="https://stanfordrosenthal.com">Stanford Rosenthal</a>.
        <a href="${url('/contact')}">Contact</a> · <a href="${url('/privacy')}">Privacy</a>
      </p>
    </div>
  </div>
</footer>`;
}
