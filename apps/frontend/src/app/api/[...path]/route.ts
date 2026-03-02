import { NextRequest } from 'next/server';

async function proxy(req: NextRequest, params: { path: string[] }) {
  const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';
  const API_KEY = process.env.API_KEY ?? '';

  console.log('[proxy] path:', params.path.join('/'), '| backendUrl:', `${BACKEND_URL}/${params.path.join('/')}`, '| API_KEY length:', API_KEY.length, '| first8:', API_KEY.slice(0, 8));

  const url = new URL(req.url);
  const backendUrl = `${BACKEND_URL}/${params.path.join('/')}${url.search}`;

  const headers: Record<string, string> = { 'x-api-key': API_KEY };
  const contentType = req.headers.get('content-type');
  if (contentType) headers['content-type'] = contentType;

  const init: RequestInit = { method: req.method, headers, cache: 'no-store' };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text();
  }

  const res = await fetch(backendUrl, init);

  const responseHeaders = new Headers();
  res.headers.forEach((value, key) => responseHeaders.set(key, value));

  return new Response(res.body, { status: res.status, headers: responseHeaders });
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params);
}
export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params);
}
export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params);
}
