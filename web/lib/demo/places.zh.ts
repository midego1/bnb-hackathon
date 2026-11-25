/** The demo rentals (lib/demo/script.ts PROPERTIES) in Chinese. A leaf module: the *.zh.ts narration files import it. */
const NAMES: Record<string, string> = {
  "Honda Click 125i from a shop in Chiang Mai Old City": "清迈古城一家车行的 Honda Click 125i",
  "Honda Scoopy-i from a shop in Pai": "拜县一家车行的 Honda Scoopy-i",
  "Yamaha NMAX 155 from a shop in Patong, Phuket": "普吉岛芭东一家车行的 Yamaha NMAX 155",
};

export const zhPropertyName = (name: string) => NAMES[name] ?? name;
