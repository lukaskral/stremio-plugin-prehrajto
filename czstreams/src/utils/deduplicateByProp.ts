export function deduplicateByProp<
  R extends Record<string, string>,
  A extends Array<R>,
>(arr: A, propName: keyof R) {
  return Object.values(
    Object.fromEntries(arr.map((item) => [item[propName], item])),
  );
}
