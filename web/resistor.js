const BAND_COLORS = [
  { name: "black", hex: "#202124" },
  { name: "brown", hex: "#70452b" },
  { name: "red", hex: "#c9362c" },
  { name: "orange", hex: "#df7a12" },
  { name: "yellow", hex: "#e2b714" },
  { name: "green", hex: "#27764a" },
  { name: "blue", hex: "#2d5fac" },
  { name: "violet", hex: "#79499a" },
  { name: "gray", hex: "#73777b" },
  { name: "white", hex: "#f1eee4" },
];

export function formatResistance(value) {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toPrecision(3))} MΩ`;
  if (value >= 1_000) return `${Number((value / 1_000).toPrecision(3))} kΩ`;
  return `${Number(value.toPrecision(3))} Ω`;
}

export function resistorCode(resistanceOhms) {
  if (!Number.isFinite(resistanceOhms) || resistanceOhms <= 0) return undefined;
  let multiplier = Math.floor(Math.log10(resistanceOhms)) - 1;
  let significant = Math.round(resistanceOhms / (10 ** multiplier));
  if (significant >= 100) { significant = Math.round(significant / 10); multiplier += 1; }
  const first = Math.floor(significant / 10); const second = significant % 10;
  const multiplierBand = multiplier >= 0 && multiplier <= 9 ? BAND_COLORS[multiplier] : multiplier === -1 ? { name: "gold", hex: "#b28a2e" } : multiplier === -2 ? { name: "silver", hex: "#a7a7a7" } : undefined;
  if (!BAND_COLORS[first] || !BAND_COLORS[second] || !multiplierBand) return undefined;
  return { bands: [BAND_COLORS[first], BAND_COLORS[second], multiplierBand, { name: "gold", hex: "#b28a2e" }], label: formatResistance(resistanceOhms) };
}

export function createResistorAsset(resistanceOhms) {
  const code = resistorCode(resistanceOhms); if (!code) return undefined;
  const [first, second, multiplier, tolerance] = code.bands; const bandNames = code.bands.map((band) => band.name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="190" height="58" viewBox="0 0 190 58"><defs><linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ead9b5"/><stop offset=".48" stop-color="#cfb985"/><stop offset="1" stop-color="#a98c59"/></linearGradient><linearGradient id="wire" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#d8d9d7"/><stop offset=".5" stop-color="#7d817f"/><stop offset="1" stop-color="#d8d9d7"/></linearGradient><filter id="shadow" x="-10%" y="-30%" width="120%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity=".22"/></filter></defs><g filter="url(#shadow)"><rect x="4" y="27" width="182" height="4" rx="2" fill="url(#wire)"/><path d="M47 15c-7 0-12 6-12 14s5 14 12 14h96c7 0 12-6 12-14s-5-14-12-14z" fill="url(#body)" stroke="#806d49" stroke-width="1"/><rect x="60" y="15" width="8" height="28" fill="${first.hex}"/><rect x="78" y="15" width="8" height="28" fill="${second.hex}"/><rect x="100" y="15" width="8" height="28" fill="${multiplier.hex}"/><rect x="130" y="15" width="7" height="28" fill="${tolerance.hex}"/><path d="M47 18h96" stroke="#fff" stroke-opacity=".38" stroke-width="2"/></g></svg>`;
  return {
    src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    alt: `${code.label} axial resistor with ${bandNames.join("-")} bands`,
    caption: `${code.label} · ${bandNames.join("–")}`,
    bands: bandNames,
  };
}
