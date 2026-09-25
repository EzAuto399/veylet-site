#!/usr/bin/env node
// Usage: node scripts/seo/psi.mjs [url-or-path ...] [options]
//
// Runs Google PageSpeed Insights (API v5, the free tier) for a list of public
// URLs, on both the mobile and desktop strategies by default, and reports
// performance/SEO/accessibility/best-practices scores plus LCP/CLS/TBT and
// any CrUX field data.
//
// Defaults to https://veylet.com/, /offer, /start, /request. Bare paths
// (starting with "/") are resolved against https://veylet.com; absolute
// URLs are used as-is, so this can audit a preview deployment too.
//
// Options:
//   --strategy=mobile|desktop|both   default: both
//   --limit=N                        cap the number of API calls this run makes
//   --delay=ms                       pause between calls (default 3000; also PSI_DELAY_MS)
//   --out=path                       where to write the JSON result
//                                    (default: scripts/seo/psi-results/latest.json)
//   --key=KEY                        PSI API key (default: PSI_API_KEY env var, else
//                                    the free unauthenticated/unkeyed quota)
//
// Examples:
//   node scripts/seo/psi.mjs                                   # 4 urls x 2 strategies = 8 calls
//   node scripts/seo/psi.mjs https://veylet.com/ --strategy=mobile --limit=1   # exactly 1 call
//
// The unauthenticated PSI quota is shared and low; this script pauses
// between calls and backs off (honouring Retry-After when present, else
// exponential backoff) on HTTP 429 rather than hammering the API.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ORIGIN = 'https://veylet.com';
const DEFAULT_PATHS = ['/', '/offer', '/start', '/request'];
const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const CATEGORIES = ['performance', 'seo', 'accessibility', 'best-practices'];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const urls = [];
  let strategy = 'both';
  let limit;
  let delay = Number(process.env.PSI_DELAY_MS) || 3000;
  let out = path.join(scriptDir, 'psi-results', 'latest.json');
  let key = '';
  for (const arg of argv) {
    if (arg.startsWith('--strategy=')) strategy = arg.slice('--strategy='.length);
    else if (arg.startsWith('--limit=')) limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--delay=')) delay = Number(arg.slice('--delay='.length));
    else if (arg.startsWith('--out=')) out = path.resolve(arg.slice('--out='.length));
    else if (arg.startsWith('--key=')) key = arg.slice('--key='.length);
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
    else urls.push(arg);
  }
  return { urls, strategy, limit, delay, out, key };
}

function printHelp() {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 27).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function buildPsiUrl(targetUrl, strategy, apiKey) {
  const u = new URL(PSI_ENDPOINT);
  u.searchParams.set('url', targetUrl);
  u.searchParams.set('strategy', strategy);
  for (const c of CATEGORIES) u.searchParams.append('category', c);
  if (apiKey) u.searchParams.set('key', apiKey);
  return u.toString();
}

async function fetchWithBackoff(url, { maxRetries = 4, baseDelayMs = 5000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.status !== 429 || attempt >= maxRetries) return res;
    const retryAfter = res.headers.get('retry-after');
    const waitMs = retryAfter ? Number(retryAfter) * 1000 : baseDelayMs * 2 ** attempt;
    console.log(`      429 rate-limited — backing off ${Math.round(waitMs / 1000)}s (retry ${attempt + 1}/${maxRetries})`);
    await sleep(waitMs);
  }
}

function pickFieldMetric(metrics, key) {
  const m = metrics && metrics[key];
  return m ? { category: m.category, percentile: m.percentile } : null;
}

function summarizeField(experience) {
  if (!experience || !experience.metrics) return null;
  const m = experience.metrics;
  return {
    overallCategory: experience.overall_category || null,
    lcp: pickFieldMetric(m, 'LARGEST_CONTENTFUL_PAINT_MS'),
    cls: pickFieldMetric(m, 'CUMULATIVE_LAYOUT_SHIFT_SCORE'),
    inp: pickFieldMetric(m, 'INTERACTION_TO_NEXT_PAINT') || pickFieldMetric(m, 'EXPERIMENTAL_INTERACTION_TO_NEXT_PAINT'),
    fcp: pickFieldMetric(m, 'FIRST_CONTENTFUL_PAINT_MS'),
  };
}

function extractSummary(json, targetUrl, strategy) {
  const lr = json.lighthouseResult || {};
  const cats = lr.categories || {};
  const audits = lr.audits || {};
  const score = (c) => (cats[c] && typeof cats[c].score === 'number' ? Math.round(cats[c].score * 100) : null);
  return {
    url: targetUrl,
    strategy,
    fetchedAt: new Date().toISOString(),
    finalUrl: lr.finalUrl || null,
    scores: {
      performance: score('performance'),
      seo: score('seo'),
      accessibility: score('accessibility'),
      bestPractices: score('best-practices'),
    },
    lab: {
      lcp: audits['largest-contentful-paint']?.displayValue ?? null,
      cls: audits['cumulative-layout-shift']?.displayValue ?? null,
      tbt: audits['total-blocking-time']?.displayValue ?? null,
    },
    field: summarizeField(json.loadingExperience),
    originField: summarizeField(json.originLoadingExperience),
  };
}

function toRow(r) {
  const field = r.field ? r.field.overallCategory : r.originField ? `origin:${r.originField.overallCategory}` : 'no field data';
  return {
    url: r.url.replace(SITE_ORIGIN, '') || '/',
    strategy: r.strategy,
    perf: r.scores.performance,
    seo: r.scores.seo,
    a11y: r.scores.accessibility,
    bp: r.scores.bestPractices,
    LCP: r.lab.lcp,
    CLS: r.lab.cls,
    TBT: r.lab.tbt,
    field,
  };
}

async function main() {
  const { urls: urlArgs, strategy: strategyArg, limit, delay, out, key } = parseArgs(process.argv.slice(2));
  const apiKey = key || process.env.PSI_API_KEY || '';

  if (!['mobile', 'desktop', 'both'].includes(strategyArg)) {
    console.error(`psi: --strategy must be mobile, desktop or both (got "${strategyArg}")`);
    process.exit(2);
  }

  const targets = (urlArgs.length ? urlArgs : DEFAULT_PATHS).map((u) => new URL(u, SITE_ORIGIN).toString());
  const strategies = strategyArg === 'both' ? ['mobile', 'desktop'] : [strategyArg];

  const combos = [];
  for (const url of targets) for (const strategy of strategies) combos.push({ url, strategy });
  const capped = Number.isFinite(limit) ? combos.slice(0, limit) : combos;

  console.log(`psi: ${capped.length} call(s) planned (${targets.length} url(s) x ${strategies.length} strateg${strategies.length === 1 ? 'y' : 'ies'})${capped.length < combos.length ? ` [capped from ${combos.length} by --limit]` : ''}`);
  console.log(apiKey ? 'psi: using PSI_API_KEY' : 'psi: no API key set — using the free unkeyed quota (low; shared; expect this to be slow or rate-limited)');

  const results = [];
  for (let i = 0; i < capped.length; i++) {
    const { url, strategy } = capped[i];
    process.stdout.write(`  [${i + 1}/${capped.length}] ${strategy.padEnd(7)} ${url} ... `);
    try {
      const res = await fetchWithBackoff(buildPsiUrl(url, strategy, apiKey));
      if (!res.ok) {
        const body = await res.text();
        console.log(`FAILED (HTTP ${res.status})`);
        results.push({ url, strategy, error: `HTTP ${res.status}: ${body.slice(0, 300)}` });
      } else {
        const json = await res.json();
        const summary = extractSummary(json, url, strategy);
        results.push(summary);
        console.log(`ok (performance ${summary.scores.performance ?? '-'})`);
      }
    } catch (err) {
      console.log(`FAILED (${err.message})`);
      results.push({ url, strategy, error: err.message });
    }
    if (i < capped.length - 1) await sleep(delay);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(`\npsi: wrote ${path.relative(process.cwd(), out) || out}`);

  const ok = results.filter((r) => !r.error);
  if (ok.length) {
    console.log('');
    console.table(ok.map(toRow));
  }
  const failed = results.filter((r) => r.error);
  if (failed.length) {
    console.log('failed calls:');
    for (const f of failed) console.log(`  ${f.strategy} ${f.url}: ${f.error}`);
  }

  process.exitCode = ok.length === 0 && results.length > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('psi: fatal error:', err);
  process.exitCode = 1;
});
