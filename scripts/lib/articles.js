/**
 * Articles: original writing for the site, one Markdown file each in data/articles/. An article about
 * an artist is shown on that artist's page. The body is plain paragraphs separated by blank lines.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './data.js';

export const ARTICLES_DIR = path.join(DATA_DIR, 'articles');

const FIELDS = ['title', 'dek', 'author', 'date', 'artist'];
const REQUIRED = ['title', 'author', 'date', 'artist'];

/** One article file: `---` front matter of `key: value` lines, then the body. */
export function parseArticle(text, slug) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) throw new Error(`data/articles/${slug}.md: missing --- front matter`);
  const article = { slug };
  for (const line of m[1].split('\n')) {
    const field = /^(\w+):\s*(.*)$/.exec(line);
    if (field) article[field[1]] = field[2].trim();
  }
  article.paragraphs = m[2]
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
  return article;
}

/** All articles from data/articles/*.md, newest first. */
export function loadArticles(dir = ARTICLES_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseArticle(fs.readFileSync(path.join(dir, f), 'utf8'), f.replace(/\.md$/, '')))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

/** Problems with the articles: [{ slug, message }]. `artistSlugs` is the set of artist slugs. */
export function checkArticles(articles, artistSlugs) {
  const problems = [];
  for (const a of articles) {
    const say = (message) => problems.push({ slug: a.slug, message });
    for (const f of REQUIRED) if (!a[f]) say(`"${f}" is required`);
    for (const f of Object.keys(a)) if (!['slug', 'paragraphs', ...FIELDS].includes(f)) say(`unknown field "${f}"`);
    if (a.date && !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) say('"date" must be YYYY-MM-DD');
    if (a.artist && !artistSlugs.has(a.artist)) say(`artist "${a.artist}" has no file in data/artists/`);
    if (!a.paragraphs.length) say('the article has no text');
    if (a.paragraphs.some((p) => /&(#\d+|#x[\da-f]+|[a-z]+);|\*\*/i.test(p))) say('the text has HTML entities or ** left in it');
  }
  return problems;
}
