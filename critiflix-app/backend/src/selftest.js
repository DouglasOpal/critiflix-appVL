// Full integration test — REQUIRES a running MongoDB (uses MONGODB_URI).
// Seeds, boots the API in-process, then exercises register/login/refresh,
// the watch→review→points→redeem loop, creator studio and admin overview.
import { spawnSync, spawn } from 'child_process';

const base = `http://localhost:${process.env.PORT || 4099}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) });

async function main() {
  console.log('[selftest] seeding…');
  const seed = spawnSync('node', ['src/seed.js'], { stdio: 'inherit', env: process.env });
  if (seed.status !== 0) { console.error('[selftest] seed failed — is MongoDB running?'); process.exit(1); }

  const srv = spawn('node', ['src/index.js'], { env: { ...process.env, PORT: String(process.env.PORT || 4099) } });
  let log = '';
  srv.stdout.on('data', (d) => (log += d));
  srv.stderr.on('data', (d) => (log += d));
  await sleep(1500);

  try {
    const out = [];
    out.push(['health', (await J(await fetch(`${base}/api/health`))).body]);

    // register a brand-new critic
    const email = `tester_${Date.now()}@mail.com`;
    const reg = await J(await fetch(`${base}/api/auth/register`, { method: 'POST', headers: h(), body: JSON.stringify({ name: 'Test Critic', email, password: 'critiflix123', role: 'critic' }) }));
    out.push(['register', { status: reg.status, code: reg.body.user?.code, hasAccess: !!reg.body.accessToken, hasRefresh: !!reg.body.refreshToken }]);

    // login with seeded critic
    const login = await J(await fetch(`${base}/api/auth/login`, { method: 'POST', headers: h(), body: JSON.stringify({ email: 'adaeze@mail.com', password: 'critiflix123' }) }));
    const access = login.body.accessToken; const refresh = login.body.refreshToken;
    out.push(['login', { status: login.status, user: login.body.user?.name }]);

    // refresh rotation
    const refreshed = await J(await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: h(), body: JSON.stringify({ refreshToken: refresh }) }));
    out.push(['refresh', { status: refreshed.status, rotated: refreshed.body.refreshToken && refreshed.body.refreshToken !== refresh }]);

    const A = h(access);
    const titles = (await J(await fetch(`${base}/api/titles`))).body;
    const tid = titles[0]._id || titles[0].id;
    out.push(['titles', { count: titles.length, first: titles[0].title }]);

    const watch = await J(await fetch(`${base}/api/titles/${tid}/watch`, { method: 'POST', headers: A }));
    out.push(['watch', watch.body]);
    const review = await J(await fetch(`${base}/api/titles/${tid}/review`, { method: 'POST', headers: A, body: JSON.stringify({ rating: 4, headline: 'Solid', body: 'Good film', tags: ['Pacing'] }) }));
    out.push(['review', { awarded: review.body.awarded, score: review.body.score }]);

    const points = await J(await fetch(`${base}/api/me/points`, { headers: A }));
    out.push(['points', { balance: points.body.balance, ledger: points.body.ledger.length }]);
    const redeem = await J(await fetch(`${base}/api/me/redeem`, { method: 'POST', headers: A, body: JSON.stringify({ points: 5000, method: 'bank', destination: 'GTBank ****4821' }) }));
    out.push(['redeem', { status: redeem.status, amount: redeem.body.cashout?.amount, balance: redeem.body.balance }]);

    const clog = await J(await fetch(`${base}/api/auth/login`, { method: 'POST', headers: h(), body: JSON.stringify({ email: 'hello@kolafilms.tv', password: 'critiflix123' }) }));
    const creatorH = h(clog.body.accessToken);
    const studio = await J(await fetch(`${base}/api/me/studio`, { headers: creatorH }));
    out.push(['studio', { avg: studio.body.stats?.avgScore, titles: studio.body.titles?.length }]);

    // subscribe (Paystack — simulated when no key) should activate the plan
    const sub = await J(await fetch(`${base}/api/me/subscribe`, { method: 'POST', headers: creatorH, body: JSON.stringify({ plan: 'studio' }) }));
    out.push(['subscribe', { status: sub.body.status, simulated: sub.body.simulated, hasCheckout: !!sub.body.checkoutUrl }]);

    const alog = await J(await fetch(`${base}/api/auth/login`, { method: 'POST', headers: h(), body: JSON.stringify({ email: 'admin@critiflix.app', password: 'critiflix123' }) }));
    const adminH = h(alog.body.accessToken);
    const ov = await J(await fetch(`${base}/api/admin/overview`, { headers: adminH }));
    out.push(['admin.overview', ov.body.kpis]);

    // pay out a pending cashout (Paystack transfer — simulated when no key)
    const cashouts = (await J(await fetch(`${base}/api/admin/cashouts`, { headers: adminH }))).body;
    const pending = cashouts.find((c) => c.status === 'review');
    if (pending) {
      const paid = await J(await fetch(`${base}/api/admin/cashouts/${pending._id}/pay`, { method: 'POST', headers: adminH }));
      out.push(['cashout.pay', { status: paid.body.status, transfer: !!paid.body.transferCode }]);
    }

    for (const [k, v] of out) console.log(k.padEnd(16), JSON.stringify(v));
    srv.kill(); process.exit(0);
  } catch (e) {
    console.error('[selftest] FAILED', e, '\n--- server log ---\n', log);
    srv.kill(); process.exit(1);
  }
}
const h = (token) => ({ 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) });
main();
