import { describe, expect, it } from 'vitest';
import { META, makeProfile, series, stationSeries } from '../test/fixtures';
import { counts, formatPercent, probabilities, stationFeatureStates, stationsGeoJson, titleCase } from './stations';

describe('probabilities / counts', () => {
  const profile = makeProfile('mon', {
    stations: { '1': stationSeries({ p_empty: series(0.4), p_full: series(0.1), bikes: series(3), docks: series(17) }) },
  });

  it('pick p_empty and bikes in bikes mode', () => {
    expect(probabilities(profile, '1', 'bikes')[0]).toBe(0.4);
    expect(counts(profile, '1', 'bikes')[0]).toBe(3);
  });

  it('pick p_full and docks in docks mode', () => {
    expect(probabilities(profile, '1', 'docks')[0]).toBe(0.1);
    expect(counts(profile, '1', 'docks')[0]).toBe(17);
  });

  it('return 96 nulls for a missing station or profile', () => {
    expect(probabilities(profile, '2', 'bikes')).toEqual(series(null));
    expect(counts(null, '1', 'bikes')).toEqual(series(null));
  });
});

describe('stationFeatureStates', () => {
  it('gives every meta station the value at the slot for the mode', () => {
    const p = series(0.05);
    p[36] = 0.7;
    const profile = makeProfile('mon', { stations: { '1': stationSeries({ p_empty: p }), '2': stationSeries() } });
    expect(stationFeatureStates(META, profile, 36, 'bikes')).toEqual([
      { id: '1', p: 0.7 },
      { id: '2', p: 0.05 },
    ]);
  });

  it('station missing from profile is null', () => {
    const profile = makeProfile('mon', { stations: { '1': stationSeries() } });
    expect(stationFeatureStates(META, profile, 0, 'docks')).toEqual([
      { id: '1', p: 0.02 },
      { id: '2', p: null },
    ]);
  });

  it('no profile yet → all null', () => {
    expect(stationFeatureStates(META, null, 0, 'bikes').map((s) => s.p)).toEqual([null, null]);
  });
});

describe('stationsGeoJson', () => {
  it('builds one point per station with lon/lat order and the id as a property', () => {
    const fc = stationsGeoJson(META);
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].geometry.coordinates).toEqual([14.506, 46.0514]);
    expect(fc.features[0].properties).toEqual({ id: '1' });
  });
});

describe('titleCase', () => {
  it('converts GBFS uppercase names, including Slovenian letters and hyphens', () => {
    expect(titleCase('PREŠERNOV TRG-PETKOVŠKOVO NABREŽJE')).toBe('Prešernov Trg-Petkovškovo Nabrežje');
  });
});

describe('formatPercent', () => {
  it('rounds to an integer percent', () => {
    expect(formatPercent(0.123)).toBe('12 %');
    expect(formatPercent(0)).toBe('0 %');
    expect(formatPercent(null)).toBe('no data');
  });
});
