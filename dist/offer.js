'use strict';
// Cost illustration only: activation and billing stay with the payment provider.
// Without JavaScript the page retains an explicitly labelled monthly invoice example.
function offerCost({ channel, cadence, monthly, annual, freeMonths = 6 }) {
  const monthCents = Math.round(Number(monthly) * 100);
  const yearCents = Math.round(Number(annual) * 100);
  if (!['studio', 'apple'].includes(channel) || !['monthly', 'annual'].includes(cadence)
      || !Number.isFinite(monthCents) || !Number.isFinite(yearCents)
      || monthCents <= 0 || yearCents <= 0 || freeMonths < 0 || freeMonths > 12) return null;
  return {
    billCents: cadence === 'annual' ? yearCents : monthCents,
    firstTwelveMonthsCents: cadence === 'annual' ? (freeMonths < 12 ? yearCents : 0) : (12 - freeMonths) * monthCents,
    annualSavingCents: monthCents * 12 - yearCents,
  };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { offerCost };
(() => {
  if (typeof document === 'undefined') return;
  const form = document.querySelector('[data-statement-form]');
  const lines = document.querySelector('[data-statement-lines]');
  const input = form && form.querySelector('input[type="date"]');
  const until = document.querySelector('[data-statement-until]');
  const plan = document.querySelector('#billing-plan');
  const channel = document.querySelector('#billing-channel');
  const cadence = document.querySelector('#billing-cadence');
  // Plan names and allowances as the offer states them; amounts come from the form's data attributes.
  const PLANS = { solo: { name: 'Solo', allowance: 'one accepted walkthrough', perMonth: 'One walkthrough' },
    team: { name: 'Team', allowance: 'three accepted walkthroughs', perMonth: 'Three walkthroughs' } };
  const money = cents => `A$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const put = (selector, value) => { const el = document.querySelector(selector); if (el) el.textContent = value; };
  const renderCost = () => {
    if (!channel || !cadence) return;
    const code = plan && Object.prototype.hasOwnProperty.call(PLANS, plan.value) ? plan.value : 'solo';
    const apple = channel.value === 'apple';
    const annual = cadence.value === 'annual';
    const amount = key => form.dataset[code + key];
    const monthly = amount(apple ? 'AppMonth' : 'WebMonth');
    const yearly = amount(apple ? 'AppYear' : 'WebYear');
    const cost = offerCost({ channel: channel.value, cadence: cadence.value, monthly, annual: yearly, freeMonths: months });
    if (!cost) return;
    put('[data-plan-name]', PLANS[code].name);
    put('[data-plan-inline]', PLANS[code].name);
    put('[data-plan-allowance]', PLANS[code].allowance);
    const extraCents = Math.round(Number(form.dataset.webExtra) * 100);
    put('[data-statement-allowance]', apple ? 'Four accepted walkthroughs in total during the free months. The in-app extra purchase is not available yet. Contact the studio before planning additional work; no extra is charged automatically and your trial end date stays the same.' : `Four accepted walkthroughs in total during the free months. Need a fifth? Arrange an extra${extraCents > 0 ? ` for ${money(extraCents)}` : ''} by studio invoice, agreed before work starts. Your trial end date stays the same.`);
    put('[data-bill-amount]', money(cost.billCents));
    put('[data-bill-cadence]', `${annual ? 'a year, paid in full' : 'a month'} ${apple ? 'in the App Store' : 'by studio invoice'}`);
    put('[data-year-total]', money(cost.firstTwelveMonthsCents));
    put('[data-total-caption]', annual ? 'One annual payment in month 7 · covers months 7–18 · excludes extras' : 'Six free months, six monthly payments · excludes extras');
    put('[data-billing-explanation]', apple
      ? `${PLANS[code].name} with an eligible six-month introductory offer. Then ${money(cost.billCents)} ${annual ? 'each year' : 'each month'} automatically unless cancelled through Apple. Apple confirms the exact dates and price before purchase. This illustration makes no purchase.`
      : `Studio invoicing for ${PLANS[code].name} is arranged under written terms. Then ${money(cost.billCents)} ${annual ? 'a year, paid in full' : 'a month'}. This website does not collect a card or activate a plan. Extras and separately agreed work are excluded.`);
    // Twelve for eleven is exact by studio invoice; Apple's nearest price point is not, so it only states the saving.
    const twelveForEleven = cost.annualSavingCents === Math.round(Number(monthly) * 100);
    put('[data-annual-saving]', `Annual billing ${twelveForEleven ? 'is twelve months for the price of eleven: it saves' : 'saves'} ${money(cost.annualSavingCents)} against twelve monthly payments. It is paid in full: ${money(Math.round(Number(yearly) * 100))} at the end of the free months, covering the following twelve months. ${PLANS[code].perMonth} per allowance month; unused allowance does not carry over.`);
  };
  if (!form || !lines || !input) return;
  const months = Number(lines.dataset.trialMonths) || 6;
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
  const parse = value => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const render = () => {
    const start = parse(input.value);
    lines.querySelectorAll('[data-free-month]').forEach(row => {
      const n = Number(row.dataset.freeMonth);
      const when = row.querySelector('[data-line-when]');
      if (!when) return;
      if (!start) { when.textContent = `Month ${n}`; return; }
      const from = addMonths(start, n - 1);
      const to = new Date(addMonths(start, n).getTime() - 86400000);
      when.textContent = `${short.format(from)} – ${withYear.format(to)}`;
    });
    const paid = lines.querySelector('[data-paid-month] [data-line-when]');
    if (paid) paid.textContent = start ? `From ${withYear.format(addMonths(start, months))}` : `Month ${months + 1} onward`;
    lines.dataset.dated = start ? 'true' : 'false';
    if (until) until.textContent = start ? `Illustrated first bill: ${long.format(addMonths(start, months))}. Your provider confirms the exact date at activation.` : '';
    renderCost();
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  input.min = iso(today);
  if (!input.value) input.value = iso(today);
  input.addEventListener('input', render);
  input.addEventListener('change', render);
  if (plan) plan.addEventListener('change', render);
  if (channel) channel.addEventListener('change', render);
  if (cadence) cadence.addEventListener('change', render);
  form.addEventListener('submit', event => event.preventDefault());
  render();
})();
