import { NextRequest, NextResponse } from 'next/server';
import { getMockResponse } from './mock-data';

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const PROXY_TIMEOUT_MS = 2_000;
const BACKOFF_MS = 30_000;

let backendDown = false;
let lastFailure = 0;

async function proxyToBackend(path: string, req: NextRequest): Promise<Response | null> {
  if (backendDown && Date.now() - lastFailure < BACKOFF_MS) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
    const url = `${BACKEND_URL}${path}`;
    const res = await fetch(url, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      backendDown = false;
      return res;
    }
    return null;
  } catch {
    backendDown = true;
    lastFailure = Date.now();
    return null;
  }
}

async function handler(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path: segments } = await params;
  const apiPath = '/api/' + (segments?.join('/') ?? '');

  const backendRes = await proxyToBackend(apiPath, req);
  if (backendRes) {
    const data = await backendRes.json();
    return NextResponse.json(data);
  }

  if (req.method === 'PUT' || req.method === 'POST' || req.method === 'DELETE' || req.method === 'PATCH') {
    return NextResponse.json({ success: true, mock: true }, { headers: { 'X-Mock-Data': '1' } });
  }

  const mock = getMockResponse(apiPath);
  if (mock !== undefined) {
    return NextResponse.json(mock, { headers: { 'X-Mock-Data': '1' } });
  }

  return NextResponse.json([], { headers: { 'X-Mock-Data': '1' } });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
