// Synthetic typical/v1 data for checking the UI before the backend is deployed.
// Writes public/dev-data/v1/ (gitignored; CI never has it, so it is never deployed).
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../public/dev-data/v1/', import.meta.url);
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const STATIONS = 60;
const CENTER = { lat: 46.0569, lon: 14.5058 };

const round = (x, decimals) => Math.round(x * 10 ** decimals) / 10 ** decimals;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

const stations = Array.from({ length: STATIONS }, (_, i) => {
  const angle = (i / STATIONS) * 6 * Math.PI; // a spiral around the centre
  const r = 0.004 + (i / STATIONS) * 0.025;
  return {
    id: String(i + 1),
    name: `TESTNA POSTAJA ŠT. ${i + 1}`,
    lat: round(CENTER.lat + r * Math.sin(angle), 5),
    lon: round(CENTER.lon + 1.4 * r * Math.cos(angle), 5),
    capacity: 15 + (i % 4) * 5,
  };
});

mkdirSync(OUT, { recursive: true });
writeFileSync(
  new URL('meta.json', OUT),
  JSON.stringify({ generated_at: new Date().toISOString(), timezone: 'Europe/Ljubljana', slot_minutes: 15, stations }),
);

DAYS.forEach((day, d) => {
  const weekend = d >= 5;
  // Sunday is "thin" so the Limited data note can be checked.
  const profile = { profile: day, days_used: day === 'sun' ? 1.2 : 4.3, stations: {} };
  stations.forEach((s, i) => {
    const series = { bikes: [], docks: [], p_empty: [], p_full: [] };
    for (let slot = 0; slot < 96; slot++) {
      const h = slot / 4;
      // Residential stations (odd) empty in the morning; central ones (even) fill up.
      const commute = weekend ? 0 : Math.exp(-((h - 8) ** 2) / 2) - Math.exp(-((h - 17) ** 2) / 3);
      const direction = i % 2 ? -1 : 1;
      const fill = clamp01(0.5 + 0.5 * direction * commute + 0.1 * Math.sin(i + h / 3));
      const noData = i === STATIONS - 1 && h < 6; // one station without night data → grey
      const bikes = fill * s.capacity;
      series.bikes.push(noData ? null : round(bikes, 1));
      series.docks.push(noData ? null : round(s.capacity - bikes, 1));
      series.p_empty.push(noData ? null : round(clamp01((0.35 - fill) / 0.35), 2));
      series.p_full.push(noData ? null : round(clamp01((fill - 0.65) / 0.35), 2));
    }
    profile.stations[s.id] = series;
  });
  writeFileSync(new URL(`${day}.json`, OUT), JSON.stringify(profile));
});

console.log(`wrote ${DAYS.length + 1} files to ${OUT.pathname}`);
