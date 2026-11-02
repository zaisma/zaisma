/**
 * How Zaisma compares what's typed with a game's title: accents and punctuation don't matter, so "pokemon" finds "Pokémon" and "hollow
 * knight" finds "Hollow-Knight". The marks come off Latin, Greek and Cyrillic letters only: in Japanese and other scripts they change the
 * letter. An apostrophe joins its word ("Assassin's" is "assassins"); any other punctuation parts words.
 */
export function searchWords(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/([\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
}

/** How much text it is, for the rules on short text: each letter or number counts 1, and a Chinese or Japanese character 2. */
export function searchLetterCount(words: string): number {
  let letterCount = 0;
  for (const character of words) {
    if (character === " ") continue;
    letterCount += /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(character) ? 2 : 1;
  }
  return letterCount;
}

/** Whether a title holds the whole word "Zaisma", in any case or with any accents: "Zaisma Quest" and "ZAÏSMA!" do, "Zaismatic" doesn't. */
export function titleNamesZaisma(title: string): boolean {
  // Unlike searchWords, an apostrophe parts words here, so "Zaisma's Quest" holds the word too.
  return searchWords(title.replace(/['’`]/g, " ")).split(" ").includes("zaisma");
}
