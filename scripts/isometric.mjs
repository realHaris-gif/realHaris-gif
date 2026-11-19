// Generates an isometric "skyline" contribution graph as SVG (light + dark).
// Style modeled on the Isometric Contributions browser extension.
// Env: USERNAME, GITHUB_TOKEN, optional SHOW_STATS=false (skyline only), OUT_DIR

import { mkdirSync, writeFileSync } from 'node:fs';

const USER = process.env.USERNAME;
const TOKEN = process.env.GITHUB_TOKEN;
const SHOW_STATS = process.env.SHOW_STATS !== 'false';
const OUT = process.env.OUT_DIR || 'isometric';

if (!USER || !TOKEN) {
  console.error('USERNAME and GITHUB_TOKEN are required');
  process.exit(1);
}

const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{date contributionCount weekday}}}}}}`;
const res = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: {
    Authorization: `bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'isometric-skyline',
  },
  body: JSON.stringify({ query, variables: { login: USER } }),
});
const json = await res.json();
if (!res.ok || json.errors || !json.data?.user) {
  console.error('GitHub API error:', JSON.stringify(json));
  process.exit(1);
}

const weeks = json.data.user.contributionsCollection.contributionCalendar.weeks;
const days = weeks.flatMap((w) => w.contributionDays);

// ---------- stats ----------
const counts = days.map((d) => d.contributionCount);
const max = Math.max(...counts, 1);
const total = counts.reduce((a, b) => a + b, 0);
const best = days.reduce((a, d) => (d.contributionCount > a.contributionCount ? d : a), days[0]);
const avg = (total / days.length).toFixed(2);

const nz = counts.filter((n) => n > 0).sort((a, b) => a - b);
const q = [0.25, 0.5, 0.75].map((p) => nz[Math.floor(p * (nz.length - 1))] ?? 0);
const level = (n) => (n === 0 ? 0 : n <= q[0] ? 1 : n <= q[1] ? 2 : n <= q[2] ? 3 : 4);

function streaks() {
  let longest = { len: 0 };
  let run = null;
  for (const d of days) {
    if (d.contributionCount > 0) {
      if (!run) run = { start: d.date, len: 0 };
      run.len++;
      run.end = d.date;
      if (run.len > longest.len) longest = { ...run };
    } else run = null;
  }
  let i = days.length - 1;
  if (days[i].contributionCount === 0) i--; // today may still be in progress
  let cur = { len: 0 };
  if (i >= 0 && days[i].contributionCount > 0) {
    let j = i;
    while (j >= 0 && days[j].contributionCount > 0) j--;
    cur = { len: i - j, start: days[j + 1].date, end: days[i].date };
  }
  return { longest, cur };
}
const { longest, cur } = streaks();

const fmt = (iso) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const range = (r) => (r.len ? `${fmt(r.start)} → ${fmt(r.end)}` : '—');

// ---------- drawing ----------
const themes = {
  light: {
    text: '#24292f', muted: '#6e7781', border: '#d0d7de', accent: '#3f8f3f',
    levels: ['#ebedf0', '#b7e4b4', '#7fc57c', '#5aa05a', '#3a6b3a'],
  },
  dark: {
    text: '#e6edf3', muted: '#8b949e', border: '#30363d', accent: '#39d353',
    levels: ['#2d333b', '#0e4429', '#006d32', '#26a641', '#39d353'],
  },
};

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f));
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function render(t) {
  const S = 16, MAXH = 130;
  const c = Math.cos(Math.PI / 6) * S;
  const s = Math.sin(Math.PI / 6) * S;
  const nW = weeks.length;
  const ox = 40 + 7 * c;
  const oy = MAXH + 30;
  const P = (x, y, z) => `${(ox + (x - y) * c).toFixed(1)},${(oy + (x + y) * s - z).toFixed(1)}`;
  const W = Math.ceil(ox + nW * c + 40);
  const H = Math.ceil(oy + (nW + 7) * s + 70);

  let body = '';
  weeks.forEach((w, x) => {
    w.contributionDays.forEach((d) => {
      const y = d.weekday;
      const n = d.contributionCount;
      const h = n ? 4 + Math.sqrt(n / max) * MAXH : 2;
      const top = t.levels[level(n)];
      const face = (pts, col) =>
        `<polygon points="${pts}" fill="${col}" stroke="${col}" stroke-width="0.6" stroke-linejoin="round"/>`;
      body += face(`${P(x, y + 1, h)} ${P(x + 1, y + 1, h)} ${P(x + 1, y + 1, 0)} ${P(x, y + 1, 0)}`, shade(top, 0.82));
      body += face(`${P(x + 1, y + 1, h)} ${P(x + 1, y, h)} ${P(x + 1, y, 0)} ${P(x + 1, y + 1, 0)}`, shade(top, 0.66));
      body += face(`${P(x, y, h)} ${P(x + 1, y, h)} ${P(x + 1, y + 1, h)} ${P(x, y + 1, h)}`, top);
    });
  });

  let panels = '';
  if (SHOW_STATS) {
    const font = `font-family="-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"`;
    const txt = (x, y, size, fill, weight, str, anchor = 'start') =>
      `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" ${font}>${str}</text>`;
    const unit = (v) => `${v}<tspan font-size="18" dx="4">days</tspan>`;

    // Contributions panel (top right)
    const cx = W - 40 - 320, cy = 30;
    panels += txt(cx, cy + 16, 18, t.text, 600, 'Contributions');
    panels += `<rect x="${cx}" y="${cy + 30}" width="320" height="104" rx="6" fill="none" stroke="${t.border}"/>`;
    panels += txt(cx + 24, cy + 74, 34, t.accent, 500, total.toLocaleString('en-US'));
    panels += txt(cx + 24, cy + 98, 14, t.text, 600, 'Total');
    panels += txt(cx + 24, cy + 120, 13, t.muted, 400, `${fmt(days[0].date)} → ${fmt(days.at(-1).date)}`);
    panels += txt(cx + 190, cy + 74, 34, t.accent, 500, best.contributionCount.toLocaleString('en-US'));
    panels += txt(cx + 190, cy + 98, 14, t.text, 600, 'Best day');
    panels += txt(cx + 190, cy + 120, 13, t.muted, 400, fmt(best.date));
    panels += `<text x="${cx + 170}" y="${cy + 160}" font-size="15" fill="${t.text}" ${font}>Average: <tspan fill="${t.accent}">${avg}</tspan> / day</text>`;

    // Streaks panel (bottom left)
    const sx = 40, sy = H - 200;
    panels += txt(sx, sy + 16, 18, t.text, 600, 'Streaks');
    panels += `<rect x="${sx}" y="${sy + 30}" width="320" height="104" rx="6" fill="none" stroke="${t.border}"/>`;
    panels += `<text x="${sx + 24}" y="${sy + 74}" font-size="34" font-weight="500" fill="${t.accent}" ${font}>${unit(longest.len)}</text>`;
    panels += txt(sx + 24, sy + 98, 14, t.text, 600, 'Longest');
    panels += txt(sx + 24, sy + 120, 13, t.muted, 400, range(longest));
    panels += `<text x="${sx + 190}" y="${sy + 74}" font-size="34" font-weight="500" fill="${t.accent}" ${font}>${unit(cur.len)}</text>`;
    panels += txt(sx + 190, sy + 98, 14, t.text, 600, 'Current');
    panels += txt(sx + 190, sy + 120, 13, t.muted, 400, range(cur));

    // Legend (bottom right)
    const ly = H - 30;
    panels += txt(W - 40, ly + 11, 13, t.muted, 400, 'More', 'end');
    t.levels
      .slice()
      .reverse()
      .forEach((col, i) => {
        panels += `<rect x="${W - 40 - 44 - (i + 1) * 16}" y="${ly}" width="12" height="12" rx="2" fill="${col}"/>`;
      });
    panels += txt(W - 40 - 44 - 5 * 16 - 8, ly + 11, 13, t.muted, 400, 'Less', 'end');
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${body}${panels}</svg>`;
}

mkdirSync(OUT, { recursive: true });
for (const name of Object.keys(themes)) {
  writeFileSync(`${OUT}/skyline-${name}.svg`, render(themes[name]));
}
console.log(`Wrote ${OUT}/skyline-light.svg and ${OUT}/skyline-dark.svg`);
