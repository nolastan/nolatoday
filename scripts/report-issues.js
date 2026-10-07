#!/usr/bin/env node
/**
 * Open GitHub issues for scrapers that need repair, and close them when they
 * recover. Runs in the scrape workflow after data/status.json is updated.
 *
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY (owner/repo)
 *      MAX_NEW_ISSUES (default 10) — cap per run so a bad night doesn't flood the tracker
 *      DRY_RUN=1 — print what would happen
 */
import { loadVenues, loadStatus } from './lib/data.js';
import { diagnose, issueTitle, issueBody, parseMarker, LABEL, KIND_LABELS } from './lib/diagnose.js';

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const dryRun = Boolean(process.env.DRY_RUN);
const maxNew = Number(process.env.MAX_NEW_ISSUES ?? 10);
// Broken scrapers first — they used to work, so they're the most valuable fixes.
const PRIORITY = { broken: 0, empty: 1, 'needs-source': 2 };

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 422) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function openIssues() {
  const issues = [];
  for (let page = 1; page < 20; page++) {
    const batch = await gh('GET', `/repos/${repo}/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=100&page=${page}`);
    issues.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  return issues;
}

async function ensureLabels() {
  const labels = [
    { name: LABEL, color: 'ffa500', description: 'Venue schedule scrapers' },
    { name: KIND_LABELS.broken, color: 'd73a4a', description: 'Scraper is erroring' },
    { name: KIND_LABELS.empty, color: 'fbca04', description: 'Scraper runs but finds no events' },
    { name: KIND_LABELS['needs-source'], color: '68909e', description: 'Venue needs a schedule source' },
  ];
  for (const label of labels) await gh('POST', `/repos/${repo}/labels`, label); // 422 = already exists
}

async function main() {
  const venues = loadVenues();
  const status = loadStatus();
  const problems = diagnose(venues, status).sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
  const wanted = new Map(problems.map((p) => [`${p.slug}|${p.kind}`, p]));

  if (dryRun || !token || !repo) {
    if (!dryRun) console.log('GITHUB_TOKEN/GITHUB_REPOSITORY not set; printing instead.');
    for (const p of problems) console.log(`${p.kind.padEnd(13)} ${p.slug}  — ${issueTitle(p)}`);
    console.log(`${problems.length} venues need attention`);
    return;
  }

  await ensureLabels();
  const existing = await openIssues();
  const existingKeys = new Map();
  for (const issue of existing) {
    const m = parseMarker(issue.body);
    if (m) existingKeys.set(`${m.slug}|${m.kind}`, issue);
  }

  // Close issues whose problem has gone away.
  for (const [key, issue] of existingKeys) {
    if (wanted.has(key)) continue;
    const [slug] = key.split('|');
    const venue = venues.find((v) => v.slug === slug);
    const entry = status.venues?.[slug];
    const why = !venue
      ? 'the venue was removed from `data/venues/`'
      : venue.status !== 'active'
        ? `the venue is now marked \`${venue.status}\``
        : `the latest run found ${entry?.count ?? 0} upcoming events`;
    console.log(`Closing #${issue.number} (${key}): ${why}`);
    await gh('POST', `/repos/${repo}/issues/${issue.number}/comments`, {
      body: `Resolved automatically: ${why}.`,
    });
    await gh('PATCH', `/repos/${repo}/issues/${issue.number}`, { state: 'closed', state_reason: 'completed' });
  }

  // Open issues for new problems (capped), and refresh the error on existing "broken" ones.
  let created = 0;
  for (const [key, problem] of wanted) {
    const issue = existingKeys.get(key);
    const body = issueBody(problem, { repo });
    if (issue) {
      if (problem.kind === 'broken' && issue.body !== body) {
        await gh('PATCH', `/repos/${repo}/issues/${issue.number}`, { body });
      }
      continue;
    }
    if (created >= maxNew) continue;
    const res = await gh('POST', `/repos/${repo}/issues`, {
      title: issueTitle(problem),
      body,
      labels: [LABEL, KIND_LABELS[problem.kind]],
    });
    created++;
    console.log(`Opened #${res.number}: ${issueTitle(problem)}`);
  }
  const pending = [...wanted.keys()].filter((k) => !existingKeys.has(k)).length - created;
  console.log(`${problems.length} problems; opened ${created} issues${pending > 0 ? `, ${pending} more waiting for the next run` : ''}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

