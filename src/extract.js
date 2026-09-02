/**
 * URL → readable article text, for the "paste a link" entry path.
 *
 * Two things make this more than a fetch call.
 *
 * 1. SSRF. This runs behind POST /api/extract, so the URL is attacker-controlled.
 *    An unguarded fetch turns the server into an open proxy for its own private
 *    network — http://localhost:6379, or the cloud metadata endpoint at
 *    169.254.169.254 which hands out credentials. Every hostname is resolved and
 *    checked against private ranges before a socket is opened, and every redirect
 *    hop is re-checked, because a public host can redirect to a private one.
 *
 * 2. Failing usefully. A JS-rendered SPA and a paywalled article both return 200
 *    with almost no prose. Reporting "extracted 40 characters" as success sends
 *    an empty deck to Gemini and wastes the user's credit, so a too-thin result
 *    is an error with a message that says what to do instead.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

/** Roughly 3k tokens of prose — enough for a 10-slide deck, cheap to send. */
const MAX_CHARS = Number(process.env.EXTRACT_MAX_CHARS ?? 12_000);
/** Below this, the page is a paywall, a cookie wall, or a JS-only shell. */
const MIN_CHARS = Number(process.env.EXTRACT_MIN_CHARS ?? 400);
const MAX_BYTES = Number(process.env.EXTRACT_MAX_BYTES ?? 5_000_000);
const TIMEOUT_MS = Number(process.env.EXTRACT_TIMEOUT_MS ?? 20_000);
const MAX_REDIRECTS = 5;

const UA =
  'Mozilla/5.0 (compatible; StoryloomBot/0.1; +https://storyloom.app) Chrome/120 Safari/537.36';

// ------------------------------------------------------------------ SSRF guard

/**
 * Expand an IPv6 address to its eight 16-bit groups, or null if unparseable.
 * Needed because the URL parser rewrites addresses into whichever form is
 * shortest: `::ffff:10.0.0.1` arrives as `::ffff:a00:1`, so string matching on
 * the dotted form misses it entirely.
 */
function expandIPv6(addr) {
  let str = addr;
  // A trailing dotted quad (::ffff:10.0.0.1) becomes two hex groups.
  const tail = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(str);
  if (tail) {
    const o = tail[1].split('.').map(Number);
    if (o.some((n) => n > 255)) return null;
    str = `${str.slice(0, tail.index)}:${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = str.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
  const groups =
    rest === null ? head : [...head, ...Array(8 - head.length - rest.length).fill('0'), ...rest];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => parseInt(g || '0', 16));
  return nums.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff) ? null : nums;
}

const ipv4From = (hi, lo) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;

/** True for loopback, private, link-local, CGNAT and unique-local addresses. */
function isPrivateAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  const v6 = ip.toLowerCase().split('%')[0]; // drop any zone index
  const g = expandIPv6(v6);
  if (!g) return true; // unparseable — refuse rather than guess

  if (g.every((n) => n === 0)) return true; // ::
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local

  // Addresses that carry an IPv4 address inside them — each is a documented way
  // to smuggle 127.0.0.1 or 169.254.169.254 past a naive v6 check.
  const zeroPrefix = (n) => g.slice(0, n).every((x) => x === 0);
  if (zeroPrefix(5) && g[5] === 0xffff) return isPrivateAddress(ipv4From(g[6], g[7])); // ::ffff:0:0/96 mapped
  if (zeroPrefix(6)) return isPrivateAddress(ipv4From(g[6], g[7])); // ::/96 compatible
  if (g[0] === 0x0064 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPrivateAddress(ipv4From(g[6], g[7])); // 64:ff9b::/96 NAT64
  }
  if (g[0] === 0x2002) return isPrivateAddress(ipv4From(g[1], g[2])); // 2002::/16 6to4

  return false;
}

/**
 * Resolve the hostname and refuse anything pointing inside the network.
 * Returns null when the host is safe, or a reason string when it is not.
 */
async function unsafeHostReason(hostname) {
  const bare = hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (isIP(bare)) {
    return isPrivateAddress(bare) ? `${bare} is a private or loopback address` : null;
  }
  if (bare === 'localhost' || bare.endsWith('.localhost') || bare.endsWith('.internal')) {
    return `${bare} resolves to this machine`;
  }
  let addresses;
  try {
    addresses = await lookup(bare, { all: true });
  } catch (err) {
    return `could not resolve ${bare} (${err.code ?? err.message})`;
  }
  // Refuse if *any* address is private: a hostname with both a public and a
  // private A record would otherwise be a coin flip.
  const bad = addresses.find((a) => isPrivateAddress(a.address));
  return bad ? `${bare} resolves to the private address ${bad.address}` : null;
}

function parseUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    return { error: { kind: 'bad_url', message: `Not a valid URL: ${input}` } };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      error: {
        kind: 'unsupported_protocol',
        message: `Only http and https are supported, got "${url.protocol}"`,
      },
    };
  }
  return { url };
}

// ------------------------------------------------------------------- transport

/** Read a response body with a hard byte ceiling so a huge page can't OOM us. */
async function readCapped(response) {
  const reader = response.body?.getReader();
  if (!reader) return { text: '', truncatedBytes: false };
  const chunks = [];
  let size = 0;
  let truncatedBytes = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      chunks.push(value.slice(0, value.byteLength - (size - MAX_BYTES)));
      truncatedBytes = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return { text: new TextDecoder('utf-8').decode(Buffer.concat(chunks)), truncatedBytes };
}

/**
 * Fetch following redirects manually, re-running the SSRF check on every hop.
 * `redirect: "follow"` would do the hops inside undici where we cannot inspect
 * them — a public URL that 302s to 169.254.169.254 would sail straight through.
 */
async function fetchHtml(startUrl) {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const reason = await unsafeHostReason(current.hostname);
    if (reason) return { error: { kind: 'blocked_host', message: `Refused: ${reason}` } };

    let response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      return {
        error: {
          kind: 'fetch_error',
          message:
            err.name === 'TimeoutError'
              ? `Timed out after ${TIMEOUT_MS}ms fetching ${current.hostname}`
              : `Could not fetch ${current.hostname}: ${err.message}`,
        },
      };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return { error: { kind: 'http_error', message: `${response.status} with no Location header` } };
      }
      current = new URL(location, current); // relative Location is legal
      if (current.protocol !== 'http:' && current.protocol !== 'https:') {
        return {
          error: { kind: 'unsupported_protocol', message: `Redirected to ${current.protocol}` },
        };
      }
      continue;
    }

    if (!response.ok) {
      const hint =
        response.status === 403 || response.status === 401
          ? ' The site is blocking automated readers — paste the text instead.'
          : '';
      return {
        error: { kind: 'http_error', status: response.status, message: `${response.status} ${response.statusText}.${hint}` },
      };
    }

    const type = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) {
      return {
        error: {
          kind: 'not_html',
          message: `Expected an HTML page, got "${type.split(';')[0] || 'unknown'}". PDFs and images are not supported yet.`,
        },
      };
    }

    const { text, truncatedBytes } = await readCapped(response);
    return { html: text, finalUrl: current.href, truncatedBytes };
  }

  return { error: { kind: 'too_many_redirects', message: `More than ${MAX_REDIRECTS} redirects` } };
}

// -------------------------------------------------------------------- cleanup

/** Block-level elements whose end should read as a paragraph break. */
const BLOCK_SELECTOR =
  'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, dd, dt, br, tr, section, article, div';

/**
 * Turn Readability's cleaned HTML into prose.
 *
 * `article.textContent` is not usable directly: it concatenates block elements
 * with no separator, so a Wikipedia infobox arrives as
 * "Jollof riceAlternative namesBenachin, riz au gras" — unreadable to a person
 * and worse to a language model, which will quote the run-on back as a sentence.
 *
 * Rather than select block elements and read them (which loses text belonging
 * directly to a skipped ancestor), this inserts real newlines into the tree and
 * then takes the whole thing — lossless, and the boundaries survive.
 */
function textFromContent(contentHtml) {
  if (!contentHtml) return '';
  const dom = new JSDOM(`<body>${contentHtml}</body>`);
  const doc = dom.window.document;
  try {
    // Tables are layout, figcaptions are asides, and <sup> on Wikipedia is the
    // [1][2] citation markers — none of it is prose worth spending tokens on.
    doc
      .querySelectorAll('table, figure, figcaption, sup, style, script, noscript, aside, nav')
      .forEach((el) => el.remove());
    doc.querySelectorAll(BLOCK_SELECTOR).forEach((el) => el.after(doc.createTextNode('\n\n')));
    return doc.body.textContent;
  } finally {
    dom.window.close();
  }
}
/** Collapse the whitespace Readability leaves behind, keeping paragraph breaks. */
function tidy(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Truncate at a paragraph, then a sentence, then a word — in that order. */
function truncate(text, max) {
  if (text.length <= max) return { text, truncated: false };
  const window = text.slice(0, max);
  const para = window.lastIndexOf('\n\n');
  if (para > max * 0.5) return { text: window.slice(0, para).trimEnd(), truncated: true };
  const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
  if (sentence > max * 0.5) return { text: window.slice(0, sentence + 1), truncated: true };
  const space = window.lastIndexOf(' ');
  return { text: (space > 0 ? window.slice(0, space) : window).trimEnd(), truncated: true };
}

// ---------------------------------------------------------------- public entry

/**
 * @param {string} input  the URL to read
 * @param {object} [opts]
 * @param {number} [opts.maxChars]
 * @returns {Promise<{ok: true, url: string, finalUrl: string, title: string, byline: string|null,
 *                    siteName: string|null, text: string, chars: number, truncated: boolean}
 *                 | {ok: false, kind: string, message: string}>}
 */
export async function extractArticle(input, { maxChars = MAX_CHARS } = {}) {
  const { url, error: urlError } = parseUrl(input);
  if (urlError) return { ok: false, ...urlError };

  const { html, finalUrl, truncatedBytes, error } = await fetchHtml(url);
  if (error) return { ok: false, ...error };

  let article;
  try {
    // No runScripts and no resources: jsdom must not execute or fetch anything
    // from a page we do not control.
    const dom = new JSDOM(html, { url: finalUrl });
    article = new Readability(dom.window.document).parse();
    dom.window.close();
  } catch (err) {
    return { ok: false, kind: 'parse_error', message: `Could not parse the page: ${err.message}` };
  }

  if (!article) {
    return {
      ok: false,
      kind: 'no_article',
      message: 'Found no article on that page. It may be a homepage or a feed rather than a single post.',
    };
  }

  // Prefer the structured HTML; fall back to the flat text if it yields nothing.
  const body = tidy(textFromContent(article.content)) || tidy(article.textContent);
  if (body.length < MIN_CHARS) {
    return {
      ok: false,
      kind: 'too_thin',
      message: `Only ${body.length} characters of text — the page is probably paywalled or renders its content with JavaScript. Copy the text and paste it directly instead.`,
    };
  }

  const { text, truncated } = truncate(body, maxChars);
  return {
    ok: true,
    url: url.href,
    finalUrl,
    title: tidy(article.title) || '',
    byline: article.byline ? tidy(article.byline) : null,
    siteName: article.siteName ? tidy(article.siteName) : null,
    text,
    chars: text.length,
    truncated: truncated || truncatedBytes,
  };
}

// CLI: node src/extract.js <url> [-o out.txt]
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const target = argv.find((a) => !a.startsWith('-'));
  if (!target) {
    console.error('usage: node src/extract.js <url> [-o article.txt]');
    process.exit(2);
  }
  const outIndex = argv.indexOf('-o');
  const out = outIndex === -1 ? null : argv[outIndex + 1];

  const result = await extractArticle(target);
  if (!result.ok) {
    console.error(`FAIL  [${result.kind}] ${result.message}`);
    process.exit(1);
  }
  console.error(
    `OK    ${result.chars} chars${result.truncated ? ' (truncated)' : ''}` +
      `\n      title:  ${result.title || '(none)'}` +
      `\n      site:   ${result.siteName || '(none)'}` +
      (result.byline ? `\n      byline: ${result.byline}` : '') +
      (result.finalUrl !== result.url ? `\n      final:  ${result.finalUrl}` : '')
  );
  if (out) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(out, `${result.text}\n`);
    console.error(`      written to ${out}`);
  } else {
    console.log(result.text);
  }
}
