/**
 * Whisper artefacts: words or phrases looped many times ("mana bu yerda mana bu yerda …") and stock hallucinations
 * on music/silence. Applied to every recognised piece before it reaches the LLM and the stored transcript.
 */
const HALLUCINATIONS = [
  /^musiqa\.?$/i,
  /^\[?(музыка|music|musiqa)\]?\.?$/i,
  /^(продолжение следует|субтитры|subtitles?)(\s|[.,!…]|$).*$/i,
  /^спасибо за просмотр\.?$/i,
];

/** Collapses an n-gram (1–8 words) repeated 3+ times in a row to one occurrence. */
export function collapseRepeats(text: string): string {
  let words = text.split(/\s+/).filter(Boolean);
  for (let n = 1; n <= 8; n++) {
    const out: string[] = [];
    let i = 0;
    while (i < words.length) {
      const gram = words.slice(i, i + n);
      let reps = 1;
      while (
        gram.length === n &&
        i + (reps + 1) * n <= words.length &&
        words
          .slice(i + reps * n, i + (reps + 1) * n)
          .every((w, k) => w.toLowerCase().replace(/[.,!?]/g, '') === gram[k].toLowerCase().replace(/[.,!?]/g, ''))
      ) {
        reps++;
      }
      if (reps >= 3) {
        out.push(...gram);
        i += reps * n;
      } else {
        out.push(words[i]);
        i++;
      }
    }
    words = out;
  }
  return words.join(' ');
}

export function cleanText(text: string): string {
  const t = collapseRepeats(text.replace(/\s+/g, ' ').trim());
  if (!t || HALLUCINATIONS.some((re) => re.test(t))) return '';
  return t;
}
