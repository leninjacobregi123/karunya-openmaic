// Playback load test: simulates concurrent students loading their assigned course.
// Hits the per-playback server path /api/classroom?id=... (session verify + enrollment
// check + disk read) — the work every student playback load does (no LLM).
const B = 'http://localhost:3000';
async function login(e, p) {
  const r = await fetch(B + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, password: p }),
  });
  return (r.headers.get('set-cookie') || '').match(/maic_session=[^;]+/)?.[0] || '';
}
const cookie = await login('student1@karunya.edu', 'student123');
if (!cookie) {
  console.log('login failed');
  process.exit(1);
}
const PATH = '/api/classroom?id=dpd_r20zDT';
async function once() {
  const t = performance.now();
  const r = await fetch(B + PATH, { headers: { Cookie: cookie } });
  await r.text();
  return { ms: performance.now() - t, ok: r.status === 200, status: r.status };
}
async function run(concurrency, total) {
  let i = 0;
  const lat = [];
  let errs = 0;
  const t0 = performance.now();
  async function worker() {
    while (i < total) {
      i++;
      const r = await once();
      lat.push(r.ms);
      if (!r.ok) errs++;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const wall = (performance.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  const pct = (q) => lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] || 0;
  console.log(
    `conc=${String(concurrency).padStart(3)} total=${total} | ${(total / wall).toFixed(0).padStart(4)} req/s | p50=${pct(0.5).toFixed(0)}ms p95=${pct(0.95).toFixed(0)}ms p99=${pct(0.99).toFixed(0)}ms max=${lat[lat.length - 1].toFixed(0)}ms | errors=${errs}`,
  );
}
console.log('warmup…');
await run(20, 200);
console.log('--- ramp ---');
await run(50, 1000);
await run(200, 4000);
await run(500, 10000);
