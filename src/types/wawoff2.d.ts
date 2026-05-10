// wawoff2 ships no types; it exposes a default export with `compress` and
// `decompress` (Promise-returning) that operate on Uint8Array buffers.
declare module "wawoff2" {
  const wawoff2: {
    compress(input: Uint8Array): Promise<Uint8Array>;
    decompress(input: Uint8Array): Promise<Uint8Array>;
  };
  export default wawoff2;
}
