/**
 * Is this (Uzbek-mode) Whisper output really Russian speech? The Uzbek checkpoint writes Russian speech as Latin
 * transliteration ("xorosho, seychas posmotryu") or in Cyrillic. Marker words decide; ambiguous ones ("da", "nu",
 * one-letter words) are not counted.
 */
const RU = new Set(
  `ya ty vy my oni ona eto etot eta chto shto chto-to kak gde kogda pochemu potomu net tak uje uzhe tolko mojno mozhno
  nado nujno nuzhno xorosho horosho harasho spasibo pojaluysta pozhaluysta pojalusta seychas sechas sichas zdravstvuyte
  zdrastvuyte zdraste allo alyo devushka skajite skazhite pravilno ponyal ponyala ponyatno ochen bylo byl byla budet
  budu yest menya mne vas vam nas nam vashe vash vasha dlya ili chtoby yesli esli togda tam tut zdes kotoryy kotoraya
  sistema rabotaet rabotayet mojete mozhete mogu mogli sdelat posmotret posmotryu smotrite skoro odin dva tri
  minutku minutochku podojdite podozhdite vsyo vse vsego tozhe toje eshyo yeshche esche`.split(/\s+/),
);
const UZ = new Set(
  `va bu men siz biz ular ha yo'q yoq bor kerak rahmat mumkin edi qiling bo'ladi boladi bo'yicha boyicha uchun bilan
  nima qanday qachon qayerda qayerdan endi hozir mana ana assalomu alaykum yaxshi yaxshimisiz xo'p xop ishlamayapti
  ishlayapti tizim tizimga kirish qilib qildim qilyapman bo'lsa bo'lgan aytib ayting beraman bering kalit kaliti
  shunaqa unaqa anaqa yana keyin oldin juda bitta ikkita qaysi nimaga chunki lekin ammo balki albatta`.split(/\s+/),
);

export function languageStats(text: string): { ru: number; uz: number } {
  let ru = 0;
  let uz = 0;
  for (const raw of text.toLowerCase().split(/[\s,.!?;:()"«»]+/)) {
    const w = raw.replace(/[‘’ʻʼ`]/g, "'");
    if (w.length < 2) continue;
    if (/[а-яё]/.test(w)) ru++;
    else if (RU.has(w)) ru++;
    else if (UZ.has(w)) uz++;
  }
  return { ru, uz };
}

/** Share of Russian among the marker words (0 when there are none). */
export function russianShare(text: string): number {
  const { ru, uz } = languageStats(text);
  return ru + uz === 0 ? 0 : ru / (ru + uz);
}

export function callLanguage(texts: readonly string[]): 'uz' | 'ru' | 'mixed' {
  const share = russianShare(texts.join(' '));
  return share >= 0.7 ? 'ru' : share >= 0.2 ? 'mixed' : 'uz';
}
