const sourceKey = 'kokjipseo:entry-source';
const digestKey = 'kokjipseo:entry-email-digest';
const sources = ['pickply', 'instagram', 'community', 'platform', 'email'] as const;
type Source = typeof sources[number];
const validSource = (value: string | null): value is Source => sources.some(source => source === value);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Attribution only: the server must still validate digest ownership. */
export function createEntryContext(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  let source: Source | null = null;
  let digest: string | null = null;
  try {
    const saved = storage.getItem(sourceKey);
    source = validSource(saved) ? saved : null;
    const savedDigest = storage.getItem(digestKey);
    digest = source === 'email' && savedDigest && uuid.test(savedDigest) ? savedDigest : null;
  } catch { /* Storage may be unavailable. */ }
  return { capture(search: string, hash: string, initial = false) {
    const params = new URLSearchParams(hash.split('?')[1] ?? '');
    const campaign = new URLSearchParams(search).get('src');
    if (params.get('source') === 'email') {
      source = 'email';
      const next = params.get('digest');
      if (next && uuid.test(next)) digest = next;
    } else if (initial && source !== 'email' && validSource(campaign) && campaign !== 'email') {
      source = campaign;
      digest = null;
    }
    try {
      if (source) storage.setItem(sourceKey, source);
      if (digest) storage.setItem(digestKey, digest);
      else storage.removeItem(digestKey);
    } catch { /* Preserve context in memory. */ }
    return { source, digest };
  } };
}

let context: ReturnType<typeof createEntryContext> | undefined;
export function captureEntryContext() {
  const initial = !context;
  context ??= createEntryContext({
    getItem: key => window.sessionStorage.getItem(key),
    setItem: (key, value) => window.sessionStorage.setItem(key, value),
    removeItem: key => window.sessionStorage.removeItem(key),
  });
  return context.capture(window.location.search, window.location.hash, initial);
}
