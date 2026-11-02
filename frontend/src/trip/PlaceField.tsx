import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Station } from '../data/types';
import { LJUBLJANA_CENTER, insideLjubljana } from './boundary';
import { matchStations, searchPlaces } from './search';
import type { LngLat, Place } from './types';

export interface PlaceFieldProps {
  label: 'From' | 'To';
  value: Place | null;
  onChange: (p: Place | null) => void;
  stations: Station[];
  token: string;
  allowMyLocation: boolean;
  onChooseOnMap: () => void;
  onNotice: (msg: string) => void;
}

const SEARCH_PAUSE_MS = 400;
const MIN_SEARCH_CHARS = 3;
const OUTSIDE_NOTICE = 'Pick a point inside Ljubljana';

/** The answer to one query: places, or the search failed. */
type SearchOutcome = { query: string; places: Place[] } | { query: string; failed: true };

interface Suggestion {
  key: string;
  label: string;
  detail?: string;
  run: () => void;
}

export function PlaceField({ label, value, onChange, stations, token, allowMyLocation, onChooseOnMap, onNotice }: PlaceFieldProps) {
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null); // null: show the chosen place
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  // Numbers the location requests; a fix only counts while its number is still the latest.
  const fixRequest = useRef(0);
  useEffect(() => {
    const requests = fixRequest;
    return () => {
      requests.current++; // unmounted: whatever fix is still on its way is dropped
    };
  }, []);

  const query = (text ?? '').trim();
  const searchable = open && query.length >= MIN_SEARCH_CHARS;

  useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchPlaces(token, query, LJUBLJANA_CENTER, controller.signal).then(
        (places) => setOutcome({ query, places }),
        () => {
          if (!controller.signal.aborted) setOutcome({ query, failed: true });
        },
      );
    }, SEARCH_PAUSE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchable, query, token]);

  const choose = (place: Place) => {
    if (!insideLjubljana(place.at)) {
      onNotice(OUTSIDE_NOTICE);
      return;
    }
    fixRequest.current++; // a deliberate choice beats a fix still on its way
    onChange(place);
    setText(null);
    setOpen(false);
  };

  const useMyLocation = () => {
    setOpen(false);
    setText(null);
    if (!navigator.geolocation) {
      onNotice("Couldn't get your location");
      return;
    }
    const request = ++fixRequest.current;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (request !== fixRequest.current) return;
        const at: LngLat = { lon: coords.longitude, lat: coords.latitude };
        if (insideLjubljana(at)) onChange({ name: 'My location', detail: '', at });
        else onNotice(OUTSIDE_NOTICE);
      },
      () => {
        if (request === fixRequest.current) onNotice("Couldn't get your location");
      },
    );
  };

  const suggestions: Suggestion[] = [];
  if (allowMyLocation) suggestions.push({ key: 'my-location', label: 'My location', run: useMyLocation });
  suggestions.push({
    key: 'map',
    label: 'Choose on map',
    run: () => {
      setOpen(false);
      setText(null);
      onChooseOnMap();
    },
  });
  const toSuggestion = (p: Place, key: string): Suggestion => ({ key, label: p.name, detail: p.detail, run: () => choose(p) });
  for (const p of matchStations(query, stations)) suggestions.push(toSuggestion(p, `station:${p.name}`));
  const current = outcome?.query === query ? outcome : null;
  const failed = current !== null && 'failed' in current;
  if (current && 'places' in current) {
    current.places.forEach((p, i) => suggestions.push(toSuggestion(p, `place:${i}`)));
  }

  const onInputChange = (next: string) => {
    setText(next);
    setOpen(true);
    if (next === '' && value) onChange(null);
  };

  const options = () => Array.from(root.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);

  const onOptionKey = (e: KeyboardEvent<HTMLElement>, run: () => void) => {
    const all = options();
    const i = all.indexOf(e.currentTarget);
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      run();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      all[Math.min(i + 1, all.length - 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      (i > 0 ? all[i - 1] : input.current)?.focus();
    } else if (e.key === 'Escape') {
      setOpen(false);
      input.current?.focus();
    }
  };

  return (
    <div
      ref={root}
      className="trip-field"
      onBlur={(e) => {
        if (e.relatedTarget instanceof Node && root.current?.contains(e.relatedTarget)) return;
        setOpen(false);
        setText(null);
      }}
    >
      <input
        ref={input}
        type="text"
        className="trip-input"
        aria-label={label}
        placeholder={label}
        autoComplete="off"
        value={text ?? value?.name ?? ''}
        onFocus={(e) => {
          setOpen(true);
          e.currentTarget.select();
        }}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            options()[0]?.focus();
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <div className="trip-suggestions" onMouseDown={(e) => e.preventDefault()}>
          <ul id={listId} role="listbox" aria-label={`${label} suggestions`}>
            {suggestions.map((s) => (
              <li
                key={s.key}
                role="option"
                aria-selected={false}
                tabIndex={-1}
                className="trip-option"
                onClick={s.run}
                onKeyDown={(e) => onOptionKey(e, s.run)}
              >
                {s.label}
                {s.detail && <span className="trip-option-detail">{s.detail}</span>}
              </li>
            ))}
          </ul>
          {failed && (
            <p role="status" className="trip-suggestion-note">
              Search unavailable
            </p>
          )}
        </div>
      )}
    </div>
  );
}
