// The JamBase quota probe is not metered. A gateway failure there is not a
// dead venue source, and it must not be followed by a metered events call.

export const QUOTA_PROBE_URL = 'https://api.data.jambase.com/v3/quota';
export const QUOTA_PROBE_ATTEMPTS = 3;

const QUOTA_PROBE_MESSAGE = new RegExp(
  `^(?:jambase: )?HTTP (?:502|503|504) for ${QUOTA_PROBE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
);

export function isQuotaProbeMessage(message) {
  return QUOTA_PROBE_MESSAGE.test(String(message ?? '').trim());
}

function failureMessages(entry) {
  const fromSources = Array.isArray(entry.sources)
    ? entry.sources.filter((source) => source && source.ok === false).map((source) => String(source.error ?? '').trim())
    : [];
  if (fromSources.length) return fromSources;
  return String(entry.error ?? '')
    .split(' | ')
    .map((message) => message.trim())
    .filter(Boolean);
}

/** True when every recorded failure is a 502/503/504 on the unmetered quota URL. */
export function isUnmeteredQuotaOutage(entry) {
  if (!entry || entry.ok !== false) return false;
  const messages = failureMessages(entry);
  return messages.length > 0 && messages.every((message) => isQuotaProbeMessage(message));
}
