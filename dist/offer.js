'use strict';
// Cost illustration only: activation and billing stay with the payment provider.
// Without JavaScript the page keeps an explicitly labelled example: the Veylet plan by
// monthly billing through the App Store, with no pack. The plan is billed monthly or
// annually: monthly pays each paid month after the free months; annual
// pays one year, once, on the day the free months end, and that year runs past month twelve.
// Nothing is charged during the free months; the first charge is on the day they end. A
// walkthrough pack is optional and bought once, at its website (card or invoice) price on
// a separate transaction. Pack in-app purchase is unavailable in this app version and arrives in a later version.
function offerTotal({ channel, cadence = 'monthly', monthly, annual, freeMonths = 3, packPrice = 0 }) {
  const packCents = Math.round(Number(packPrice) * 100);
  if (channel !== 'apple' || !['monthly', 'annual'].includes(cadence)
      || !Number.isFinite(packCents) || packCents < 0
      || !Number.isInteger(freeMonths) || freeMonths < 0 || freeMonths > 12) return null;
  const billCents = Math.round(Number(cadence === 'annual' ? annual : monthly) * 100);
  if (!Number.isFinite(billCents) || billCents <= 0) return null;
  const planCents = cadence === 'annual' ? billCents : (12 - freeMonths) * billCents;
  return { billCents, packCents, firstTwelveMonthsCents: planCents + packCents };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { offerTotal };
(() => {
  if (typeof document === 'undefined') return;
  const form = document.querySelector('[data-statement-form]');
  const lines = document.querySelector('[data-statement-lines]');
  const input = form && form.querySelector('input[type="date"]');
  const until = document.querySelector('[data-statement-until]');
  const cadence = document.querySelector('#billing-cadence');
  const channel = document.querySelector('#billing-channel');
  const pack = document.querySelector('#billing-pack');
  const PACKS = ['pack3', 'pack10'];
  const money = cents => `A$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const put = (selector, value) => { const el = document.querySelector(selector); if (el) el.textContent = value; };
  const isAnnual = () => !!cadence && cadence.value === 'annual';
  // Amounts, counts and validity come from the form's data attributes. With the monthly plan
  // through Apple and no pack, the text below is exactly the page's own no-script text.
  const renderCost = () => {
    if (!channel) return;
    const data = form.dataset;
    const annual = isAnnual();
    const code = pack && PACKS.includes(pack.value) ? pack.value : '';
    const count = code ? Number(data[code + 'Walkthroughs']) : 0;
    const valid = Number(data.packValidMonths);
    const sizes = PACKS.every(key => Number(data[key + 'Walkthroughs']) > 0);
    const [free, included, banked, pool, bonus, bonusExpress] = [data.freeIncluded, data.planIncluded, data.planBankedMax,
      data.planYearIncluded, data.earlyAnnualBonus, data.earlyAnnualExpress].map(Number);
    const cost = offerTotal({ channel: channel.value, cadence: annual ? 'annual' : 'monthly',
      monthly: data.planAppMonth, annual: data.planAppYear,
      freeMonths: months, packPrice: code ? data[code + 'Web'] : 0 });
    if (!cost || !sizes || !(valid > 0) || (code && !(count > 0 && cost.packCents > 0))
        || ![free, included, banked, pool, bonus, bonusExpress].every(n => Number.isInteger(n) && n > 0)) return;
    // Annual savings are separate from introductory eligibility; do not round them into free months.
    const monthCents = Math.round(Number(data.planAppMonth) * 100);
    const yearCents = Math.round(Number(data.planAppYear) * 100);
    const savedCents = 12 * monthCents - yearCents;
    const savedPercent = monthCents > 0 ? (savedCents / (12 * monthCents) * 100).toFixed(1) : '';
    const paid = 12 - months;
    put('[data-bill-amount]', money(cost.billCents));
    put('[data-bill-cadence]', `${annual ? 'upfront a year' : 'a month'} in the App Store`);
    const packLine = document.querySelector('[data-pack-line]');
    if (packLine) packLine.hidden = !code;
    if (code) {
      put('[data-pack-what]', `Pack of ${count} walkthroughs · by card or invoice · valid ${valid} months`);
      put('[data-pack-amount]', money(cost.packCents));
    }
    const payments = annual
      ? `1 yearly App Store payment for months ${months + 1} to ${months + 12}`
      : `${paid} monthly App Store payments`;
    put('[data-year-total]', money(cost.firstTwelveMonthsCents));
    put('[data-total-caption]', code ? `${months} free months, ${payments} and the pack` : `${months} free months, then ${payments}`);
    const freePart = `${free} accepted walkthroughs in total during the ${months} free months.`;
    const planPart = annual
      ? `Then ${pool} to use any time in your paid plan year, with no monthly limit and no rollover between years. Choose annual before your free months end and get ${bonus} bonus walkthroughs and ${bonusExpress} Super fast renders in your first plan year, ${pool + bonus} walkthroughs in total.`
      : `Then ${included} a month on the plan; unused ones roll over, up to ${banked} banked.`;
    const packPart = code
      ? `The pack adds ${count}, used after the included ones and valid ${valid} months from purchase. You can buy it during the free months; the free-months end date stays the same.`
      : `Need more? A pack adds ${data.pack3Walkthroughs} or ${data.pack10Walkthroughs} walkthroughs, and you can buy one during the free months. The free-months end date stays the same.`;
    put('[data-statement-allowance]', `${freePart} ${planPart} ${packPart}`);
    const saving = annual && savedCents > 0
      ? ` Annual saves ${money(savedCents)} (${savedPercent}%) compared with 12 monthly payments.` : '';
    put('[data-billing-explanation]', `Illustration for the Veylet plan with an eligible ${months}-month App Store introductory offer, then ${money(cost.billCents)} each ${annual ? 'year' : 'month'} automatically unless cancelled through Apple. Apple confirms the exact dates and price before purchase.${saving}${code ? ' The one-time pack is a separate website or invoice purchase; it does not recur or change the Apple subscription.' : ''} Nothing is charged by this calculator.`);
  };
  if (!form || !lines || !input) return;
  const months = Number(lines.dataset.trialMonths) || 3;
  const long = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const short = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' });
  const withYear = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  const addMonths = (date, count) => {
    const next = new Date(date.getTime());
    const day = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + count);
    const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, last));
    return next;
  };
  const dayBefore = date => new Date(date.getTime() - 86400000);
  const parse = value => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const render = () => {
    const start = parse(input.value);
    const annual = isAnnual();
    lines.querySelectorAll('[data-free-month]').forEach(row => {
      const n = Number(row.dataset.freeMonth);
      const when = row.querySelector('[data-line-when]');
      if (!when) return;
      if (!start) { when.textContent = `Month ${n}`; return; }
      const from = addMonths(start, n - 1);
      when.textContent = `${short.format(from)} – ${withYear.format(dayBefore(addMonths(start, n)))}`;
    });
    // Monthly runs on from the first paid month; annual covers one year from it.
    const paid = lines.querySelector('[data-paid-month] [data-line-when]');
    if (paid) {
      const first = start && addMonths(start, months);
      paid.textContent = annual
        ? (start ? `${withYear.format(first)} – ${withYear.format(dayBefore(addMonths(start, months + 12)))}` : `Months ${months + 1} to ${months + 12}`)
        : (start ? `From ${withYear.format(first)}` : `Month ${months + 1} onward`);
    }
    lines.dataset.dated = start ? 'true' : 'false';
    // The rule (nothing until the free months end, nothing if cancelled first) is the line above; this one dates it.
    if (until) until.textContent = start ? `Illustrated first charge: ${long.format(addMonths(start, months))}, the day your free months end.` : '';
    renderCost();
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  input.min = iso(today);
  if (!input.value) input.value = iso(today);
  input.addEventListener('input', render);
  input.addEventListener('change', render);
  for (const control of [cadence, channel, pack]) if (control) control.addEventListener('change', render);
  form.addEventListener('submit', event => event.preventDefault());
  render();
})();
