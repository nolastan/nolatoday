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

// Runs before first paint so the page never flashes the wrong theme.
const THEME_BOOT = `(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}})();`;

const SUN = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></g></svg>';
const MOON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z"/></svg>';

export function themeToggle() {
  return `<button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch color theme" title="Switch light/dark mode"><span class="icon-sun">${SUN}</span><span class="icon-moon">${MOON}</span></button>`;
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
<link rel="icon" href="${asset('/favicon.svg')}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;500;600;700&family=Orelega+One&display=swap">
<link rel="stylesheet" href="${asset('/assets/styles.css')}">
<script>${THEME_BOOT}</script>
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
  <a class="brand" href="${url('/')}">NOLA<span>.</span>Today</a>
  <nav class="site-nav" aria-label="Main">
    ${link('/', 'Map', 'map')}
    ${link('/venues', 'Venues', 'venues')}
    ${themeToggle()}
  </nav>
</header>`;
}

export function siteFooter(ctx) {
  const { config, url } = ctx;
  return `<footer class="site-footer">
  <div class="wrap footer-inner">
    <div>
      <a class="brand" href="${url('/')}">NOLA<span>.</span>Today</a>
      <p class="muted">Mapping live music in New Orleans. Schedules are gathered automatically from venue websites and ticketing pages — always confirm with the venue before heading out.</p>
    </div>
    <nav class="footer-nav" aria-label="Footer">
      <a href="${url('/')}">Map</a>
      <a href="${url('/venues')}">Venues</a>
      ${config.social?.instagram ? `<a href="${esc(config.social.instagram)}" rel="noopener">Instagram</a>` : ''}
      ${config.social?.facebook ? `<a href="${esc(config.social.facebook)}" rel="noopener">Facebook</a>` : ''}
      <a href="https://github.com/${esc(config.repo)}" rel="noopener">GitHub</a>
    </nav>
  </div>
</footer>`;
}
