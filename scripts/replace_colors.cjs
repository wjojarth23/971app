const fs = require('fs');

const targetPath = 'src/app.css';
const css = fs.readFileSync(targetPath, 'utf8');

const mappingEntries = [
  ['#000000', 'var(--color-black)'],
  ['#006064', 'var(--teal-500)'],
  ['#007bff', 'var(--blue-500)'],
  ['#0277bd', 'var(--blue-600)'],
  ['#050505', 'var(--color-black)'],
  ['#0b6623', 'var(--green-700)'],
  ['#0f609b', 'var(--blue-700)'],
  ['#111827', 'var(--neutral-900)'],
  ['#11642a', 'var(--green-600)'],
  ['#1565c0', 'var(--blue-600)'],
  ['#166534', 'var(--green-700)'],
  ['#1976d2', 'var(--blue-600)'],
  ['#1b4f72', 'var(--blue-700)'],
  ['#1b5e20', 'var(--green-600)'],
  ['#1d4ed8', 'var(--blue-500)'],
  ['#1e60d1', 'var(--blue-600)'],
  ['#212529', 'var(--neutral-800)'],
  ['#229954', 'var(--green-500)'],
  ['#27ae60', 'var(--green-500)'],
  ['#28a745', 'var(--green-500)'],
  ['#2e7d32', 'var(--green-500)'],
  ['#2ecc71', 'var(--green-500)'],
  ['#333', 'var(--neutral-700)'],
  ['#3498db', 'var(--blue-500)'],
  ['#3730a3', 'var(--purple-600)'],
  ['#374151', 'var(--neutral-700)'],
  ['#388e3c', 'var(--green-500)'],
  ['#3a2f00', 'var(--brand-900)'],
  ['#444', 'var(--neutral-700)'],
  ['#4b5563', 'var(--neutral-600)'],
  ['#4caf50', 'var(--green-500)'],
  ['#555', 'var(--neutral-600)'],
  ['#5a4300', 'var(--brand-800)'],
  ['#5c6bc0', 'var(--purple-500)'],
  ['#5e35b1', 'var(--purple-500)'],
  ['#5f6775', 'var(--text-muted)'],
  ['#616161', 'var(--neutral-500)'],
  ['#666', 'var(--neutral-500)'],
  ['#6b7280', 'var(--neutral-500)'],
  ['#6c757d', 'var(--neutral-500)'],
  ['#6f42c1', 'var(--purple-600)'],
  ['#757575', 'var(--neutral-500)'],
  ['#7a0b0b', 'var(--red-800)'],
  ['#7a0f0f', 'var(--red-800)'],
  ['#7b1fa2', 'var(--purple-600)'],
  ['#80deea', 'var(--teal-100)'],
  ['#81d4fa', 'var(--blue-300)'],
  ['#8a6d3b', 'var(--brand-700)'],
  ['#8b0000', 'var(--red-800)'],
  ['#8f5f00', 'var(--brand-700)'],
  ['#90caf9', 'var(--blue-200)'],
  ['#92400e', 'var(--brand-800)'],
  ['#999', 'var(--neutral-400)'],
  ['#9e9e9e', 'var(--neutral-400)'],
  ['#9fa8da', 'var(--purple-100)'],
  ['#a5d6a7', 'var(--green-200)'],
  ['#a7e0c1', 'var(--green-200)'],
  ['#a7e9b6', 'var(--green-100)'],
  ['#bbdefb', 'var(--blue-100)'],
  ['#bbf7d0', 'var(--green-100)'],
  ['#b33', 'var(--red-600)'],
  ['#b6d3ff', 'var(--blue-150)'],
  ['#b6e0fe', 'var(--blue-100)'],
  ['#b91c1c', 'var(--red-600)'],
  ['#bfdbfe', 'var(--blue-100)'],
  ['#c2185b', 'var(--pink-500)'],
  ['#c5b3e6', 'var(--purple-150)'],
  ['#c62828', 'var(--red-600)'],
  ['#ce93d8', 'var(--purple-100)'],
  ['#ccc', 'var(--neutral-300)'],
  ['#d4a829', 'var(--brand-500)'],
  ['#dc3545', 'var(--red-500)'],
  ['#dcfce7', 'var(--green-50)'],
  ['#e0e0e0', 'var(--neutral-200)'],
  ['#e0f2fe', 'var(--blue-50)'],
  ['#e0f7fa', 'var(--teal-50)'],
  ['#e1e5e9', 'var(--neutral-200)'],
  ['#e1f5fe', 'var(--blue-50)'],
  ['#e3f2fd', 'var(--blue-50)'],
  ['#e5e7eb', 'var(--neutral-200)'],
  ['#e6f0ff', 'var(--blue-50)'],
  ['#e6ffed', 'var(--green-50)'],
  ['#e74c3c', 'var(--red-400)'],
  ['#e8f5e8', 'var(--green-50)'],
  ['#e8f5e9', 'var(--green-50)'],
  ['#e8f6ef', 'var(--green-75)'],
  ['#e8fef1', 'var(--green-50)'],
  ['#eaf3ff', 'var(--blue-75)'],
  ['#eceff4', 'var(--surface-3)'],
  ['#ede7f6', 'var(--purple-50)'],
  ['#eef2f7', 'var(--surface-3)'],
  ['#eef2ff', 'var(--purple-50)'],
  ['#eef7ff', 'var(--blue-50)'],
  ['#ef4444', 'var(--red-400)'],
  ['#ef6c00', 'var(--orange-600)'],
  ['#ef9a9a', 'var(--red-300)'],
  ['#f0f0f0', 'var(--neutral-100)'],
  ['#f0fdf4', 'var(--green-50)'],
  ['#f1c331', 'var(--brand-400)'],
  ['#f39c12', 'var(--orange-400)'],
  ['#f3e5f5', 'var(--purple-75)'],
  ['#f3f4f6', 'var(--neutral-100)'],
  ['#f48fb1', 'var(--pink-300)'],
  ['#fafafa', 'var(--neutral-50)'],
  ['#f57c00', 'var(--orange-500)'],
  ['#f57f17', 'var(--orange-500)'],
  ['#f59e0b', 'var(--orange-400)'],
  ['#f5a5a5', 'var(--red-200)'],
  ['#f5c6c6', 'var(--red-200)'],
  ['#f5f5f5', 'var(--neutral-100)'],
  ['#f6f7fb', 'var(--surface-2)'],
  ['#f8bbd9', 'var(--pink-100)'],
  ['#f8f9fa', 'var(--neutral-50)'],
  ['#f8fafc', 'var(--neutral-50)'],
  ['#fce4ec', 'var(--pink-100)'],
  ['#fcfcfc', 'var(--color-white)'],
  ['#fde68a', 'var(--brand-100)'],
  ['#fef3c7', 'var(--brand-50)'],
  ['#ffb300', 'var(--brand-600)'],
  ['#ffc107', 'var(--brand-400)'],
  ['#ffb3b3', 'var(--red-200)'],
  ['#ffcc02', 'var(--brand-300)'],
  ['#ffdf7a', 'var(--brand-100)'],
  ['#ffe199', 'var(--brand-100)'],
  ['#ffe69c', 'var(--brand-100)'],
  ['#ffe6e6', 'var(--red-50)'],
  ['#ffe8e8', 'var(--red-75)'],
  ['#ffecec', 'var(--red-75)'],
  ['#ffebee', 'var(--red-50)'],
  ['#fff', 'var(--color-white)'],
  ['#fff2b8', 'var(--brand-50)'],
  ['#fff3cd', 'var(--brand-50)'],
  ['#fff3e0', 'var(--brand-50)'],
  ['#fff5f5', 'var(--red-50)'],
  ['#fff7cc', 'var(--brand-50)'],
  ['#fff8e1', 'var(--brand-50)'],
  ['#fff8e6', 'var(--brand-50)'],
  ['#fffaf0', 'var(--neutral-50)'],
  ['#fffef8', 'var(--neutral-50)'],
  ['#ff5722', 'var(--orange-600)'],
  ['#ff9800', 'var(--orange-500)'],
  ['#ffd54f', 'var(--brand-200)'],
  ['#ffd6d6', 'var(--red-100)'],
  ['#ffd700', 'var(--brand-300)'],
  ['#ffdede', 'var(--red-100)'],
  ['#ffffff', 'var(--color-white)'],
  ['#e8f5e8', 'var(--green-50)'],
  ['#f8f9fa', 'var(--neutral-50)'],
  ['#e8fef1', 'var(--green-50)']
];

const mapping = new Map(mappingEntries);
const colorRegex = /#[0-9a-fA-F]{3,8}\b/g;

const replaceSection = (text) =>
  text.replace(colorRegex, (match) => mapping.get(match.toLowerCase()) || match);

let result = css;
const rootIndex = css.indexOf(':root');
if (rootIndex !== -1) {
  const braceStart = css.indexOf('{', rootIndex);
  if (braceStart !== -1) {
    let depth = 1;
    let i = braceStart + 1;
    while (i < css.length && depth > 0) {
      const char = css[i];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      i += 1;
    }
    const before = css.slice(0, braceStart + 1);
    const rootContent = css.slice(braceStart + 1, i - 1);
    const after = css.slice(i - 1);
    result = replaceSection(before) + rootContent + replaceSection(after);
  } else {
    result = replaceSection(css);
  }
} else {
  result = replaceSection(css);
}

fs.writeFileSync(targetPath, result);
