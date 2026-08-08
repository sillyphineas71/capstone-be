import {
  isSimilarPlate,
  levenshteinDistance,
  maxAllowedDistance,
} from './plate-similarity.js';

describe('levenshteinDistance', () => {
  it('chuỗi giống hệt → 0', () => {
    expect(levenshteinDistance('30A12345', '30A12345')).toBe(0);
  });

  it('1 ký tự khác nhau (cùng độ dài) → 1', () => {
    expect(levenshteinDistance('30A12345', '30A12346')).toBe(1);
  });

  it('1 bên rỗng → độ dài bên kia', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('bug thật 2026-08-08: "699" vs "G69946" → 3 (Levenshtein thuần KHÔNG đủ nhỏ)', () => {
    expect(levenshteinDistance('699', 'G69946')).toBe(3);
  });

  it('"51L868" vs "86886" → 4 (khác gần như toàn bộ)', () => {
    expect(levenshteinDistance('51L868', '86886')).toBe(4);
  });
});

describe('maxAllowedDistance (bảng ngưỡng theo minLen, đã chốt 2026-08-08)', () => {
  it('minLen <= 4 → 1', () => {
    expect(maxAllowedDistance(1)).toBe(1);
    expect(maxAllowedDistance(4)).toBe(1);
  });

  it('minLen 5-6 → 2', () => {
    expect(maxAllowedDistance(5)).toBe(2);
    expect(maxAllowedDistance(6)).toBe(2);
  });

  it('minLen >= 7 → 3', () => {
    expect(maxAllowedDistance(7)).toBe(3);
    expect(maxAllowedDistance(20)).toBe(3);
  });
});

describe('isSimilarPlate', () => {
  it('giống hệt nhau → true', () => {
    expect(isSimilarPlate('30A12345', '30A12345')).toBe(true);
  });

  it('OCR lệch 1 ký tự giữa chuỗi, cùng độ dài → true (Levenshtein <= ngưỡng)', () => {
    expect(isSimilarPlate('30A12345', '30A12346')).toBe(true);
  });

  // Case log thật đêm 2026-08-08 (3 lần đọc CÙNG 1 xe, đọc thiếu/thừa đầu-cuối).
  // plateNumber gốc lưu trong row KHÔNG đổi khi gộp → mọi lần đọc sau đều so với
  // "699" (lần đọc ĐẦU TIÊN), không phải lần đọc liền trước.
  it('DONE (case log thật): "699" (gốc) vs "30G699" → true (substring)', () => {
    expect(isSimilarPlate('699', '30G699')).toBe(true);
  });

  it('DONE (case log thật): "699" (gốc) vs "G69946" → true (substring, Levenshtein thuần sẽ FAIL nếu không có lớp này)', () => {
    expect(isSimilarPlate('699', 'G69946')).toBe(true);
  });

  // Case bug thật phát hiện qua test phần cứng: direction luôn "seen" cố định cho
  // camera ANPR thuần → plateNumber phải là tín hiệu chặn gộp nhầm.
  it('DONE (bug thật): "51L868" vs "86886" (2 xe khác nhau hoàn toàn) → false', () => {
    expect(isSimilarPlate('51L868', '86886')).toBe(false);
  });

  it('1 trong 2 chuỗi rỗng → false (không đủ căn cứ để gộp)', () => {
    expect(isSimilarPlate('', '30A12345')).toBe(false);
    expect(isSimilarPlate('30A12345', '')).toBe(false);
  });

  it('minLen=7, distance=4 (4 ký tự khác, vượt ngưỡng 3) → false', () => {
    expect(isSimilarPlate('30A1234', '30X9994')).toBe(false);
  });
});
