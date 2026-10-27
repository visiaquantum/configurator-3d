/**
 * Read `record[key]` only when `key` is the record's own property. Ids, kinds
 * and catalog ids come from project files, catalogues and GLB node names, so
 * a key such as `constructor` or `toString` must read as missing rather than
 * as an inherited `Object.prototype` member.
 */
export function own<T>(record: Readonly<Record<string, T>> | null | undefined, key: string): T | undefined {
  return record && Object.hasOwn(record, key) ? record[key] : undefined
}
