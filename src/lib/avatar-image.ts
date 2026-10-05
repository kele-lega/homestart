/**
 * 浏览器里把选好的图片处理成头像再上传：从中间裁成正方形、缩到 256×256、重新编码成 WebP（不支持就 PNG）。
 * 重新编码顺带去掉照片里的 EXIF（拍摄地点等）；动图只留第一帧。服务端只认文件头、限大小（adapters/avatars）
 */

/** 头像最大也就显示 80px 左右，256 留足高分屏的余量 */
export const AVATAR_SIZE = 256;
/** 原图太大没必要读进内存解码；手机原图一般十来 MB */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const AVATAR_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

export class AvatarImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AvatarImageError';
  }
}

/** 从中间取最大的正方形：返回源图上要截的那块 [x, y, 边长] */
export function centerSquare(width: number, height: number): readonly [number, number, number] {
  const side = Math.min(width, height);
  return [Math.floor((width - side) / 2), Math.floor((height - side) / 2), side];
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new AvatarImageError('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

/** 返回 data URL，直接交给 uploadAvatar；不是图片、太大、解不开时抛 AvatarImageError */
export async function prepareAvatar(file: File): Promise<string> {
  if (!AVATAR_ACCEPT.split(',').includes(file.type)) throw new AvatarImageError('只支持 PNG、JPG、GIF、WebP 图片');
  if (file.size > MAX_SOURCE_BYTES) throw new AvatarImageError(`图片太大（最多 ${MAX_SOURCE_BYTES / 1024 / 1024} MB）`);

  let bitmap: ImageBitmap;
  try {
    // 照片按 EXIF 里的方向转正，裁出来的不会是横躺的
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new AvatarImageError('这张图片打不开，换一张试试');
  }
  try {
    const [x, y, side] = centerSquare(bitmap.width, bitmap.height);
    if (side === 0) throw new AvatarImageError('这张图片打不开，换一张试试');
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new AvatarImageError('浏览器处理不了图片');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, x, y, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    // 不支持导出 WebP 的浏览器（老 Safari）会悄悄给 PNG，按实际的类型走
    const blob = (await toBlob(canvas, 'image/webp')) ?? (await toBlob(canvas, 'image/png'));
    if (!blob) throw new AvatarImageError('浏览器处理不了图片');
    return await readAsDataUrl(blob);
  } finally {
    bitmap.close();
  }
}
