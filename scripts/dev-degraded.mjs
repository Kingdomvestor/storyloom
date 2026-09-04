/**
 * Storyloom in degraded mode — no accounts, no credits, no 401s.
 *
 * Why this exists: with Supabase configured, `requireUser` gates the authoring
 * surface, so an unauthenticated browser session gets 401 on /api/validate and
 * the app flips to the auth view. Every editor element is then display:none —
 * which reads as "not clickable" to any UI check and makes verification lie.
 * This boots the same app with the Supabase vars cleared, so the whole Week A
 * flow is open and the editor can be driven end to end.
 *
 *   npm run dev:degraded          # port 3210
 *   PORT=4000 npm run dev:degraded
 *
 * Import first, clear env after: importing server.js pulls in generate.js,
 * whose module-scope loadEnvFile() reads .env (Gemini keys included). Every
 * Supabase consumer reads env lazily at request time and nothing reloads .env,
 * so clearing the vars here holds for the life of the process. Same trick as
 * test/server-degraded.test.js.
 */
const { app } = await import('../src/server.js');

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const port = Number(process.env.PORT ?? 3210);
const server = app.listen(port, () => {
  console.log(`Storyloom (degraded — no accounts) → http://localhost:${port}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
