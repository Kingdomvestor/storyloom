import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function mountAuthFlow() {
  const dom = new JSDOM(html, { url: 'https://storyloom.local/' });
  const { document } = dom.window;
  return { document };
}

test('auth screen supports sign in, create account, and reset password modes', () => {
  const { document } = mountAuthFlow();

  const form = document.querySelector('#authForm');
  assert.ok(form, 'auth form exists');
  assert.ok(document.querySelector('#authEmail'), 'email field exists');
  assert.ok(document.querySelector('#authEmailField'), 'email field wrapper exists');
  assert.ok(document.querySelector('#authPassword'), 'password field exists');
  assert.ok(document.querySelector('#authResetLink'), 'reset link exists');
  assert.ok(!document.querySelector('#authConfirmPassword'), 'password confirmation is not required');
  assert.ok(document.querySelector('#authBackToSignIn'), 'back button for reset flow exists');
  assert.ok(!document.querySelector('[data-provider="google"]'), 'social auth provider buttons are intentionally removed from the compact layout');
});
