export * from "./is_defined.js";
export * from "./random_subset.js";

export function removeItemFromArray(arr: unknown[], value: unknown): unknown[] {
  const index = arr.indexOf(value);
  if (index > -1) {
    arr.splice(index, 1);
  }
  return arr;
}
