import { useEffect, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 640px)';

/** Desktop = floating panel + popup + 96-bar chart; otherwise docked panel + bottom sheet + 24 bars. */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setDesktop(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return desktop;
}
