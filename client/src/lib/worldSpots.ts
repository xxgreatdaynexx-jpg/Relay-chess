export type WorldSpot = { id: string; label: string; icon: string; color: number; blurb: string };

export const WORLD_SPOTS: WorldSpot[] = [
  { id: 'casino', label: 'Casino', icon: '🎰', color: 0xff3cac, blurb: 'Blackjack, roulette, poker, slots, solitaire' },
  { id: 'chess', label: 'Chess Club', icon: '♞', color: 0x7cf0ff, blurb: 'Chess, checkers & board games' },
  { id: 'mine', label: 'The Mine', icon: '⛏', color: 0xffb347, blurb: 'Dig ore & rock, haul it out' },
  { id: 'arena', label: 'Arena', icon: '🎯', color: 0xff4040, blurb: 'Multiplayer FPS deathmatch' },
  { id: 'factory', label: 'Factory', icon: '🏭', color: 0xffe066, blurb: 'Smelt ore, craft goods' },
  { id: 'warehouse', label: 'Warehouse', icon: '🎒', color: 0x9dff6a, blurb: 'Your inventory & skins' },
  { id: 'bank', label: 'Bank', icon: '🏦', color: 0x4dffb5, blurb: 'Wallet & chip history' },
  { id: 'market', label: 'Market', icon: '🏪', color: 0xb388ff, blurb: 'Skins, materials & trades' },
  { id: 'leaderboard', label: 'Leaderboard', icon: '🏆', color: 0xe8c26a, blurb: 'Who’s on top' },
  { id: 'chat', label: 'Plaza Chat', icon: '💬', color: 0x66b3ff, blurb: 'Chat & who’s online' },
];

