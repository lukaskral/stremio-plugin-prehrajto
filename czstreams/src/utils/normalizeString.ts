/**
 *
 * @param {string} word
 * @returns
 */
export function normalizeString(word: string) {
  return word
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replaceAll(/[^a-zA-Z0-9]+/g, " ");
}
