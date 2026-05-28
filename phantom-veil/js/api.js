// --- Phantom Veil — API Client Stub ---
// Fetches remote content URL; falls back to built-in procedural ocean.

const API_CONFIG = {
  baseURL: '',
  endpoint: '/api/content/default',
  authHeader: 'Authorization',
  authToken: '',
};

// Returns { url: string } on success, or null on failure/unreachable.
// Silently swallows errors — no console noise in fallback path.
export async function fetchDefaultContent() {
  const url = API_CONFIG.baseURL + API_CONFIG.endpoint;

  try {
    const headers = {};
    if (API_CONFIG.authToken) {
      headers[API_CONFIG.authHeader] = `Bearer ${API_CONFIG.authToken}`;
    }

    const resp = await fetch(url, { headers, cache: 'no-cache' });
    if (!resp.ok) return null;

    const data = await resp.json();
    if (data && typeof data.url === 'string' && data.url) {
      return { url: data.url };
    }
    return null;
  } catch (_) {
    return null; // unreachable → fallback silently
  }
}

export function getApiConfig() {
  return { ...API_CONFIG };
}
