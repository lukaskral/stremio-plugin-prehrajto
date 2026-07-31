/**
 *
 * @param {string} time
 */
export function timeToSeconds(time: string) {
  const [secs, mins = 0, hours = 0] = time
    .split(":")
    .reverse()
    .map((i) => parseInt(i, 10));

  return secs + mins * 60 + hours * 3600;
}

/**
 *
 * @param {string} sizeStr
 */
export function sizeToBytes(sizeStr: string) {
  const sizeNum = parseFloat(sizeStr.replace(",", "."));
  const sizeMul = sizeStr.includes("KB")
    ? 1024
    : sizeStr.includes("MB")
      ? 1048576
      : sizeStr.includes("GB")
        ? 1073741824
        : 1;

  return sizeNum * sizeMul;
}

/**
 * @param {number} bytes
 */
export function bytesToSize(bytes: number) {
  const suffixes = ["", "kB", "MB", "GB", "TB"];
  let b = bytes;
  let idx = 0;

  while (b > 1000) {
    b = b / 1024;
    idx += 1;
  }
  return `${Math.round(b * 10) / 10}${suffixes[idx]}`;
}
