import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { app } = await import('../src/server.js');

let base;
let server;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('known studio routes serve the app shell and unknown paths return 404', async () => {
  const shell = await (await fetch(`${base}/studio`)).text();
  assert.match(shell, /src="\/templates\/carousel\.html"/);

  for (const path of [
    '/signin',
    '/studio/new',
    '/studio/new?step=template',
    '/studio/deck/shared-deck-id',
    '/studio/admin/templates',
    '/studio/admin/styles',
    '/studio/admin/feedback',
  ]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /^text\/html\b/, path);
    assert.equal(await response.text(), shell, path);
  }

  for (const path of ['/studio/unknown', '/studio/admin/unknown', '/studio/deck', '/unknown']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), 'Not found.', path);
  }
});
