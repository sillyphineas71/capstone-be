/**
 * Chuẩn hoá 1 đoạn text (VD: tên cuộc họp) thành phần tên file an toàn để
 * dùng trong Content-Disposition/download: bỏ dấu tiếng Việt, thay ký tự
 * không phải chữ/số bằng "_", cắt độ dài để tránh tên file quá dài trên
 * Windows/macOS.
 */
export function slugifyFileNamePart(input: string, maxLength = 80): string {
  const combiningDiacriticals = new RegExp('[\\u0300-\\u036f]', 'g');
  const noDiacritics = input
    .normalize('NFD')
    .replace(combiningDiacriticals, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
  const slug = noDiacritics
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (slug || 'bien_ban').slice(0, maxLength);
}
