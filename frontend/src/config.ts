// Build-time settings; `vite build` refuses to run without them (see vite.config.ts).
export const MAPBOX_TOKEN: string = import.meta.env.VITE_MAPBOX_TOKEN ?? '';
export const DATA_BASE_URL: string = import.meta.env.VITE_DATA_BASE_URL ?? '';
