// Marks the card as ready only when Outfit has loaded and no line overflows its column.
// build.mjs reads the result from <html data-fit> via --dump-dom and refuses a bad card.
document.fonts.ready.then(() => {
  const problems = [];
  for (const weight of ['400', '500']) if (!document.fonts.check(`${weight} 40px Outfit`)) problems.push('Outfit ' + weight + ' not loaded');
  for (const img of document.images) if (!img.complete || !img.naturalWidth) problems.push('image not loaded: ' + img.getAttribute('src'));
  for (const el of document.querySelectorAll('.copy > *')) {
    const box = el.parentElement.getBoundingClientRect(), pad = parseFloat(getComputedStyle(el.parentElement).paddingRight);
    if (el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().left + el.scrollWidth > box.right - pad + 1) problems.push('overflow: ' + (el.className || el.tagName));
  }
  const copy = document.querySelector('.copy');
  if (copy.scrollHeight > copy.clientHeight + 1) problems.push('overflow: height');
  document.documentElement.dataset.fit = problems.length ? problems.join('; ') : 'ok';
});
