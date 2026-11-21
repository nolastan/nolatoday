/** Live street cameras on the map (data/cameras.json). Format in CONTRIBUTING.md. */
import path from 'node:path';
import { readJSON, DATA_DIR } from './data.js';

export const CAMERAS_FILE = path.join(DATA_DIR, 'cameras.json');

export function loadCameras(file = CAMERAS_FILE) {
  return readJSON(file, []);
}

/** Problems with a camera list, as strings. The embed is framed on the map, so it must be https. */
export function checkCameras(cameras) {
  if (!Array.isArray(cameras)) return ['must be an array'];
  const problems = [];
  cameras.forEach((c, i) => {
    const where = `[${i}]${c?.name ? ` ${c.name}` : ''}`;
    if (!c || typeof c.name !== 'string' || !c.name.trim()) problems.push(`${where}: "name" is required`);
    if (typeof c?.lat !== 'number' || c.lat < 29 || c.lat > 31) problems.push(`${where}: "lat" must be a number near New Orleans`);
    if (typeof c?.lng !== 'number' || c.lng < -91 || c.lng > -89) problems.push(`${where}: "lng" must be a number near New Orleans`);
    let url = null;
    try {
      url = new URL(c?.embed);
    } catch {}
    if (!url || url.protocol !== 'https:') problems.push(`${where}: "embed" must be an https URL`);
    if (typeof c?.embed === 'string' && c.embed.includes('&amp;')) problems.push(`${where}: "embed" has &amp; in it; write a plain &`);
  });
  return problems;
}
