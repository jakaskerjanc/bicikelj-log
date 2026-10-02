import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DATA_BASE_URL, MAPBOX_TOKEN } from './config';
import { nowInLjubljana } from './data/slots';
import './styles.css';

const now = nowInLjubljana();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App baseUrl={DATA_BASE_URL} mapboxToken={MAPBOX_TOKEN} initialDay={now.day} initialSlot={now.slot} />
  </StrictMode>,
);
