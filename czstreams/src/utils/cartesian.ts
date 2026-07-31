export function cartesian<A>(a: A[]): Array<[A]>;
export function cartesian<A, B>(a: A[], b: B[]): Array<[A, B]>;
export function cartesian<A, B, C>(a: A[], b: B[], c: C[]): Array<[A, B, C]>;
export function cartesian<A, B, C, D>(
  a: A[],
  b: B[],
  c: C[],
  d: D[],
): Array<[A, B, C, D]>;

export function cartesian<A extends Array<unknown>>(...args: Array<A>) {
  const r = [] as A;
  const max = args.length - 1;
  function helper(arr: A, i: number) {
    for (let j = 0, l = args[i].length; j < l; j++) {
      const a = arr.slice(0); // clone arr
      a.push(args[i][j]);
      if (i == max) r.push(a);
      else helper(a as A, i + 1);
    }
  }
  helper([] as A, 0);
  return r;
}
