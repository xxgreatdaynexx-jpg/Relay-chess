export type WorldSpot = { id: string; label: string; icon: string; color: number; blurb: string };

export const WORLD_SPOTS: WorldSpot[] = [
  { id: 'casino', label: 'Casino', icon: '🎰', color: 0xff3cac, blurb: 'Blackjack, roulette, poker, slots, solitaire' },
  { id: 'chess', label: 'Chess Club', icon: '♞', color: 0x7cf0ff, blurb: 'Chess, checkers & board games' },
  { id: 'mine', label: 'The Mine', icon: '⛏', color: 0xffb347, blurb: 'Dig ore & rock, haul it out (west outskirts)' },
  { id: 'mine-frost', label: 'Frostbite Caverns', icon: '❄', color: 0x8fd8ff, blurb: 'Icy halls: iron, silver & crystal (north outskirts)' },
  { id: 'mine-magma', label: 'Magma Depths', icon: '🌋', color: 0xff6a20, blurb: 'Lava tube: coal & gold (south-east outskirts)' },
  { id: 'arena', label: 'Arena', icon: '🎯', color: 0xff4040, blurb: 'Multiplayer FPS deathmatch' },
  { id: 'factory', label: 'Factory', icon: '🏭', color: 0xffe066, blurb: 'Smelt ore, craft goods' },
  { id: 'warehouse', label: 'Warehouse', icon: '🎒', color: 0x9dff6a, blurb: 'Your inventory & skins' },
  { id: 'bank', label: 'Bank', icon: '🏦', color: 0x4dffb5, blurb: 'Wallet & chip history' },
  { id: 'market', label: 'Market', icon: '🏪', color: 0xb388ff, blurb: 'Skins, materials & trades' },
  { id: 'stocks', label: 'Stock Exchange', icon: '📈', color: 0x34d399, blurb: '100 companies, live prices & news' },
  { id: 'dealer', label: 'Car Dealership', icon: '🚗', color: 0xff7a1a, blurb: '20 cars to buy, then drive the town' },
  { id: 'airport', label: 'Airport', icon: '✈️', color: 0x7ab8ff, blurb: 'Fly between the airport, downtown & the Speedway' },
  { id: 'dock', label: 'Fishing Dock', icon: '🎣', color: 0x4fc3d9, blurb: 'Cast, reel & sell your catch at the lake' },
  { id: 'racetrack', label: 'Speedway', icon: '🏁', color: 0xff4d6d, blurb: 'Time-trial your cars, Daily Cup prizes' },
  { id: 'leaderboard', label: 'Leaderboard', icon: '🏆', color: 0xe8c26a, blurb: 'Who’s on top' },
  { id: 'chat', label: 'Plaza Chat', icon: '💬', color: 0x66b3ff, blurb: 'Chat & who’s online' },
];

