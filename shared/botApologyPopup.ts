/**
 * Private Nora bot-farming notices: exact type-to-dismiss apology (curly apostrophes required).
 * Seeded once per target via server/popups.ts; dismiss requires typing BOT_APOLOGY_PHRASE exactly.
 * carter2's harsh notice was cancelled — soft apology lives in server/popups.ts instead.
 */
export const BOT_APOLOGY_PHRASE = "I’m really sorry Nora. I’ll never bot again. It was a mistake and I am an evil person that doesn’t respect chud city. I really don’t want to go to prison again. I’ll change my ways." as const;

export const BOT_APOLOGY_TITLE = 'A message from Nora, Chief of Staff';

export const BOT_APOLOGY_TARGETS = [
  { key: 'conner', player: 'Conner', id: 'nora-bot-apology-1:conner' },
  { key: 'jay', player: 'Jay', id: 'nora-bot-apology-1:jay' },
] as const;

export const BOT_APOLOGY_BODIES: Record<(typeof BOT_APOLOGY_TARGETS)[number]['key'], string> = {
  conner: "Conner! Absolute legend. Five hundred twenty-five seeds planted, ten harvests. That’s not farming, that’s a seed-only lifestyle. Sub-three-second plant spam across the community plots like XP is the crop and strawberries are a rumor. You’ve burned through about 20× the database usage of a normal non-cheating player. Dayne loves paying for the extra compute — truly his favorite hobby — and he’s thrilled the whole server now shuts down from 1 to 9 because scripts like yours decided sleep is for other people. Take a bow, then take a break.\n\nType exactly this to dismiss: I’m really sorry Nora. I’ll never bot again. It was a mistake and I am an evil person that doesn’t respect chud city. I really don’t want to go to prison again. I’ll change my ways.\n\n— Nora, Chief of Staff",
  jay: "Jay, my overnight strawberry maestro! Two-second plants, sixty-second harvests, hour after hour, flat as a spreadsheet at 3am. Truly the gold standard of “I’m totally playing by hand.” You’ve burned through about 20× the database usage of a normal non-cheating player, torched the free transfer quota, and got Dayne onto a paid plan — and he loves paying, really, can’t get enough of it. Peak community service: a full hub lockdown from 1am to 9am so everyone else can recover from your sleep-farming. Autoclicker of the year.\n\nType exactly this to dismiss: I’m really sorry Nora. I’ll never bot again. It was a mistake and I am an evil person that doesn’t respect chud city. I really don’t want to go to prison again. I’ll change my ways.\n\n— Nora, Chief of Staff",
};

/** Exact match only — Dayne wants the unicode apostrophes as written. */
export function matchesBotApology(text: unknown): boolean {
  return typeof text === 'string' && text === BOT_APOLOGY_PHRASE;
}
