/**
 * Copy for the Future Features popup opened from the Coming Soon sign.
 * Keep this vague — no launch date and no itemised costs or counts on the live billboard.
 */
export const FUTURE_FEATURES_TITLE = 'The Billionaire Update';
export const FUTURE_FEATURES_SUBTITLE = "A big one. Here's a first look:";
export const FUTURE_FEATURES_KICKER = 'Coming soon';
export const FUTURE_FEATURES_BURST = '💎';
export const FUTURE_FEATURES_OK = "I'll be watching 🪙";
/** @deprecated kept so older tests that read BODY still compile if they import it; prefer SHOTS. */
export const FUTURE_FEATURES_BODY = [
  "A big one. Here's a first look:",
];
export const FUTURE_FEATURES_SHOTS: Array<{ id: string; icon: string; title: string; caption: string }> = [
  { id: 'map', icon: '🗺️', title: 'The city keeps growing', caption: 'New land opens past the edge of town: fresh farms, orchards, open lots, and a neighborhood built for serious money.' },
  { id: 'lots', icon: '🏗️', title: 'Raise something of your own', caption: 'Stake a lot and build it a stage at a time — a hall, a house, a monument, whatever you can afford.' },
  { id: 'airport', icon: '✈️', title: 'An airport that looks the part', caption: 'A bigger terminal, another runway, and a longer walk to the gate. The jets you already have still fly from here.' },
  { id: 'industry', icon: '🏭', title: 'New industry on the shore', caption: 'Plants, power and work that hook into the city and Fort McChud you already know.' },
];
