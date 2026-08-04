/** Strings belonging to the `player` group. */
export const csPlayer = {
  "player.transport.play": "Přehrát",
  "player.transport.pause": "Pauza",
  "player.timeline.position": "{current} / {total}",
  "player.speed.rate": "{value}×",
} as const;

export const csPlayerContext: Partial<Record<keyof typeof csPlayer, string>> = {
  "player.transport.play":
    "Popisek pro čtečky obrazovky u tlačítka přehrávání, když je zvuk zastavený.",
  "player.transport.pause":
    "Popisek pro čtečky obrazovky u téhož tlačítka, když zvuk hraje. Kliknutí přehrávání pozastaví.",
  "player.timeline.position":
    "Údaj vedle časové osy: uplynulý čas a celková délka nahrávky, obojí ve tvaru m:ss nebo h:mm:ss.",
  "player.speed.rate":
    "Popisek tlačítka rychlosti přehrávání, například „1,25×“. Znak na konci je násobítko (U+00D7), ne písmeno x.",
};
