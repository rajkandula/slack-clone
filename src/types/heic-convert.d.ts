declare module "heic-convert" {
  interface HeicConvertOptions {
    buffer: Buffer | Uint8Array;
    format: "JPEG" | "PNG";
    quality?: number;
  }
  const convert: (opts: HeicConvertOptions) => Promise<Uint8Array>;
  export default convert;
}
