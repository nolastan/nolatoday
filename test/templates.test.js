import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLink } from '../src/templates/venue.js';

test('sourceLink: Instagram profiles show the handle, other sources the hostname', () => {
  assert.equal(
    sourceLink('https://www.instagram.com/okaybarnola/'),
    '<a href="https://www.instagram.com/okaybarnola/" rel="noopener nofollow">@okaybarnola</a> on Instagram',
  );
  assert.equal(sourceLink('https://www.instagram.com/p/DfdHNi-hUog/'), '<a href="https://www.instagram.com/p/DfdHNi-hUog/" rel="noopener nofollow">instagram.com</a>');
  assert.equal(sourceLink('https://www.eventbrite.com/o/venue-123'), '<a href="https://www.eventbrite.com/o/venue-123" rel="noopener nofollow">eventbrite.com</a>');
});

test('privacyPage: covers the app and links from the footer', async () => {
  const { privacyPage } = await import('../src/templates/pages.js');
  const ctx = { config: { siteName: 'NOLA.Today', siteUrl: 'https://nola.today', description: '', mapbox: {} }, url: (p) => p, asset: (p) => p };
  const html = privacyPage(ctx);
  assert.match(html, /<link rel="canonical" href="https:\/\/nola.today\/privacy">/);
  assert.match(html, /iPhone and iPad app/);
  assert.match(html, /never sent to NOLA.Today/);
  assert.match(html, /href="\/privacy">Privacy<\/a>/);
});
