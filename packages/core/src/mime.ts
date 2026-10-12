/** Every file type a game may contain, with the content type we serve it as. */
export const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  xml: "application/xml",
  csv: "text/csv; charset=utf-8",
  wasm: "application/wasm",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  obj: "text/plain; charset=utf-8",
  mtl: "text/plain; charset=utf-8",
  ktx2: "image/ktx2",
  basis: "application/octet-stream",
  hdr: "application/octet-stream",
  bin: "application/octet-stream",
  data: "application/octet-stream",
  dat: "application/octet-stream",
  pck: "application/octet-stream",
  atlas: "text/plain; charset=utf-8",
  fnt: "text/plain; charset=utf-8",
  tmx: "application/xml",
  tsx: "application/xml",
  tmj: "application/json; charset=utf-8",
  ldtk: "application/json; charset=utf-8",
};

export const TEXT_EXTENSIONS = new Set(["html", "htm", "js", "mjs", "css", "json", "svg", "xml", "txt", "md"]);
export const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extensionOf(path)] ?? "application/octet-stream";
}
