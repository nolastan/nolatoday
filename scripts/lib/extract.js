/**
 * Find `"key":` in a blob of HTML/JS and parse the JSON value (object or
 * array) that follows it, respecting nested brackets and strings. Useful for
 * pulling data out of Next.js / hydration payloads embedded in pages.
 * Returns undefined when the key isn't found or the value can't be parsed.
 */
export function extractJSONValue(text, key, { from = 0 } = {}) {
  const needle = `"${key}":`;
  let idx = text.indexOf(needle, from);
  while (idx !== -1) {
    let i = idx + needle.length;
    while (/\s/.test(text[i])) i++;
    const open = text[i];
    if (open === '[' || open === '{') {
      const end = matchBracket(text, i);
      if (end !== -1) {
        try {
          return JSON.parse(text.slice(i, end + 1));
        } catch {
          /* try next occurrence */
        }
      }
    }
    idx = text.indexOf(needle, idx + 1);
  }
  return undefined;
}

function matchBracket(text, start) {
  const stack = [];
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '[' || c === '{') stack.push(c);
    else if (c === ']' || c === '}') {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return -1;
}
