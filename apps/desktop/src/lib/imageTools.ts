export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export type Prepared = { blob: Blob; w: number; h: number };

// gönderilecek resmi hazırlar: büyükse 1920 px'e küçültür, küçükse olduğu gibi bırakır
export async function prepareImage(file: File): Promise<Prepared> {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
    throw new Error("Sadece JPG, PNG, WebP ve GIF gönderilebilir.");
  }
  const bmp = await createImageBitmap(file);
  const w0 = bmp.width;
  const h0 = bmp.height;
  const scale = Math.min(1, 1920 / Math.max(w0, h0));
  const keep = file.type === "image/gif" || (scale === 1 && file.size <= 700_000);
  if (keep) {
    bmp.close();
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("Dosya 25 MB'tan büyük.");
    return { blob: file, w: w0, h: h0 };
  }
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
  if (!blob) throw new Error("Resim işlenemedi.");
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error("Resim çok büyük.");
  return { blob, w, h };
}

// özel emoji için: 128x128 şeffaf PNG
export async function emojiFromFile(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  for (const size of [128, 96, 64]) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const s = Math.min(size / bmp.width, size / bmp.height);
    const w = bmp.width * s;
    const h = bmp.height * s;
    ctx.drawImage(bmp, (size - w) / 2, (size - h) / 2, w, h);
    const url = canvas.toDataURL("image/png");
    if (url.length < 120_000) {
      bmp.close();
      return url;
    }
  }
  bmp.close();
  throw new Error("Resim çok karmaşık, daha basit bir resim dene.");
}