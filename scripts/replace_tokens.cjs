const fs = require('fs');

const target = 'src/app.css';
let css = fs.readFileSync(target, 'utf8');

const replacements = new Map([
  ['var(--brand-50)', 'var(--brand-gold-soft)'],
  ['var(--brand-100)', 'var(--brand-gold-soft)'],
  ['var(--brand-200)', 'var(--brand-gold-soft)'],
  ['var(--brand-300)', 'var(--brand-gold-base)'],
  ['var(--brand-400)', 'var(--brand-gold-base)'],
  ['var(--brand-500)', 'var(--brand-gold-base)'],
  ['var(--brand-600)', 'var(--brand-gold-strong)'],
  ['var(--brand-700)', 'var(--brand-gold-strong)'],
  ['var(--brand-800)', 'var(--brand-gold-strong)'],
  ['var(--brand-900)', 'var(--brand-gold-strong)'],

  ['var(--blue-50)', 'var(--blue-soft)'],
  ['var(--blue-75)', 'var(--blue-soft)'],
  ['var(--blue-100)', 'var(--blue-soft)'],
  ['var(--blue-150)', 'var(--blue-soft)'],
  ['var(--blue-200)', 'var(--blue-soft)'],
  ['var(--blue-300)', 'var(--blue-base)'],
  ['var(--blue-500)', 'var(--blue-base)'],
  ['var(--blue-600)', 'var(--blue-base)'],
  ['var(--blue-700)', 'var(--blue-strong)'],

  ['var(--green-50)', 'var(--green-soft)'],
  ['var(--green-75)', 'var(--green-soft)'],
  ['var(--green-100)', 'var(--green-soft)'],
  ['var(--green-200)', 'var(--green-soft)'],
  ['var(--green-500)', 'var(--green-base)'],
  ['var(--green-600)', 'var(--green-strong)'],
  ['var(--green-700)', 'var(--green-strong)'],

  ['var(--red-50)', 'var(--red-soft)'],
  ['var(--red-75)', 'var(--red-soft)'],
  ['var(--red-100)', 'var(--red-soft)'],
  ['var(--red-200)', 'var(--red-soft)'],
  ['var(--red-300)', 'var(--red-base)'],
  ['var(--red-400)', 'var(--red-base)'],
  ['var(--red-500)', 'var(--red-base)'],
  ['var(--red-600)', 'var(--red-strong)'],
  ['var(--red-800)', 'var(--red-strong)'],

  ['var(--purple-50)', 'var(--purple-soft)'],
  ['var(--purple-75)', 'var(--purple-soft)'],
  ['var(--purple-100)', 'var(--purple-soft)'],
  ['var(--purple-150)', 'var(--purple-soft)'],
  ['var(--purple-500)', 'var(--purple-strong)'],
  ['var(--purple-600)', 'var(--purple-strong)'],

  ['var(--pink-100)', 'var(--red-soft)'],
  ['var(--pink-300)', 'var(--red-base)'],
  ['var(--pink-500)', 'var(--red-base)'],

  ['var(--orange-400)', 'var(--orange-soft)'],
  ['var(--orange-500)', 'var(--orange-strong)'],
  ['var(--orange-600)', 'var(--orange-strong)'],

  ['var(--teal-50)', 'var(--green-soft)'],
  ['var(--teal-100)', 'var(--green-soft)'],
  ['var(--teal-500)', 'var(--green-base)'],
]);

for (const [from, to] of replacements.entries()) {
  if (css.includes(from)) {
    css = css.split(from).join(to);
  }
}

fs.writeFileSync(target, css);
