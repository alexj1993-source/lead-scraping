let _usingMockData = false;

export function isUsingMockData() {
  return _usingMockData;
}

export async function checkApiHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    const res = await fetch('/api/health', { signal: controller.signal, method: 'GET' });
    clearTimeout(timer);
    const isMock = res.headers.get('X-Mock-Data') === '1';
    _usingMockData = isMock;
    return !isMock;
  } catch {
    return false;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }

  const isMock = res.headers.get('X-Mock-Data') === '1';
  if (isMock) _usingMockData = true;
  else _usingMockData = false;

  return res.json();
}
