/** Minimal types for `word-extractor` (no bundled types): only what the converter uses. */
declare module 'word-extractor' {
  interface WordDocument {
    getBody(): string;
  }
  export default class WordExtractor {
    extract(source: string | Buffer): Promise<WordDocument>;
  }
}
