#!/usr/bin/env node
/**
 * Check the official parade data against an answer key.
 *
 *   node validation/parades/compare.js              # this season's schedule page
 *   node validation/parades/compare.js --season 2026 # that season, from the Internet Archive
 *
 * The answer key is the schedule on mardigrasneworleans.com, a third-party site.
 * It is used here only to measure how complete and accurate the city's data is.
 * Nothing from it is written anywhere but validation/parades/.cache (not
 * committed), and nothing in this folder is read by the site build or the
 * pipeline. Do not copy its dates, times or routes into data/.
 *
 * WWOZ is deliberately not an answer key: its robots.txt turns automated readers away.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { loadParades, nameKey, parseClock, displayName } from '../../scripts/lib/parades.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '.cache');
const KEY_URL = 'https://www.mardigrasneworleans.com/parades/';
const USER_AGENT = 'nolatoday-parades-validation/1.0 (+https://nola.today; https://github.com/nolastan/nolatoday)';
// The key's own neighborhood headings that are inside Orleans Parish. Anything else is another parish,
// which the city's data was never going to have.
const ORLEANS = /french quarter|uptown|mid-?city|marigny|bywater|new orleans east|algiers|west ?bank \(algiers\)|downtown|cbd|treme|gentilly|lakeview|central city/i;

const seasonArg = process.argv.indexOf('--season');
const season = seasonArg !== -1 ? process.argv[seasonArg + 1] : null;

async function fetchKey() {
  const url = season ? `https://web.archive.org/web/${season}0201000000/${KEY_URL}` : KEY_URL;
  const file = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex') + '.html');
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 24 * 3600 * 1000) return fs.readFileSync(file, 'utf8');
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, html);
  return html;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4 };

function parseKey(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $('ul.parades').each((_, ul) => {
    const header = $(ul).prevAll().find('.numerical').first().text() || $(ul).parent().find('.numerical').first().text() || $(ul).closest('div').prev().find('.numerical').text();
    const m = /([A-Za-z]{3})[a-z]*\s+(\d{1,2})\s*(\d{4})/.exec(header.replace(/\s+/g, ' '));
    const date = m && MONTHS[m[1].toLowerCase()] ? `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
    let area = null;
    $(ul)
      .children('li')
      .each((__, li) => {
        if ($(li).hasClass('listing-location')) {
          area = $(li).text().trim();
          return;
        }
        const name = $(li).find('.parade').text().trim();
        if (!name) return;
        rows.push({ name, date, time: $(li).find('.time').text().trim(), area, orleans: ORLEANS.test(area ?? '') });
      });
  });
  return rows;
}

const clockText = (iso) => (iso ? iso.slice(11, 16) : null);
const keyClock = (text) => {
  const c = parseClock(text);
  return c ? `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}` : null;
};

async function main() {
  const key = parseKey(await fetchKey());
  if (!key.length) throw new Error('Could not read any parades from the answer key; its page layout may have changed.');
  const keyYear = key.find((r) => r.date)?.date.slice(0, 4);
  const official = loadParades().filter((f) => f.properties.category === 'mardi_gras' || /krewe/i.test(f.properties.name));
  const byKey = new Map();
  for (const f of official) {
    for (const name of [f.properties.name, f.properties.krewe].filter(Boolean)) {
      const k = nameKey(name);
      // Prefer the parade from the key's own year.
      if (!byKey.has(k) || f.properties.date.slice(0, 4) === keyYear) byKey.set(k, f);
    }
  }

  const stats = { orleans: 0, covered: 0, withRoute: 0, dateChecked: 0, dateAgree: 0, timeChecked: 0, timeAgree: 0, outside: 0, outsideCovered: 0 };
  const lines = [];
  for (const r of key) {
    const f = byKey.get(nameKey(r.name));
    const p = f?.properties;
    if (!r.orleans) {
      stats.outside++;
      if (f) stats.outsideCovered++;
      continue;
    }
    stats.orleans++;
    let verdict = 'MISSING from city data';
    if (f) {
      stats.covered++;
      if (f.geometry) stats.withRoute++;
      const sameSeason = p.date.slice(0, 4) === keyYear;
      const notes = [f.geometry ? (p.route_traced ? 'route traced from text' : 'route') : 'no route'];
      if (!sameSeason) notes.push(`city data is for ${p.date.slice(0, 4)}, key is ${keyYear}: schedule not compared`);
      else {
        stats.dateChecked++;
        if (p.date === r.date) stats.dateAgree++;
        else notes.push(`DATE differs: city ${p.date}, key ${r.date}`);
        const [a, b] = [clockText(p.start_time), keyClock(r.time)];
        if (a && b) {
          stats.timeChecked++;
          if (a === b) stats.timeAgree++;
          else notes.push(`time differs: city ${a}, key ${b}`);
        }
      }
      verdict = `${displayName(p)} [${p.field_sources.schedule}]: ${notes.join('; ')}`;
    }
    lines.push(`  ${(r.date ?? '????-??-??')}  ${r.name.padEnd(42)} ${verdict}`);
  }

  console.log(`Answer key: ${key.length} parades for ${keyYear} (${stats.orleans} in Orleans Parish by the key's own headings, ${stats.outside} elsewhere)\n`);
  console.log(lines.join('\n'));
  const pct = (a, b) => (b ? `${a} of ${b} (${Math.round((100 * a) / b)}%)` : 'none to compare');
  console.log(`\nOrleans Parish coverage:  ${pct(stats.covered, stats.orleans)}`);
  console.log(`  with a route line:      ${pct(stats.withRoute, stats.orleans)}`);
  console.log(`  dates that agree:       ${pct(stats.dateAgree, stats.dateChecked)}`);
  console.log(`  start times that agree: ${pct(stats.timeAgree, stats.timeChecked)}`);
  console.log(`Outside Orleans Parish:   ${pct(stats.outsideCovered, stats.outside)} (the city's data does not cover other parishes; this is not a gap in it)`);
  console.log('\nSecond lines and other permit parades have no answer key here: the only complete public calendar is on a site that does not allow automated reading.');
}

main().catch((err) => {
  console.error(`compare: ${err.message}`);
  process.exit(1);
});
