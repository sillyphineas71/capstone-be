import { NoEmojiOrControlConstraint } from './no-emoji-or-control.validator.js';

describe('NoEmojiOrControlConstraint', () => {
  let constraint: NoEmojiOrControlConstraint;

  beforeEach(() => {
    constraint = new NoEmojiOrControlConstraint();
  });

  it('should accept normal Vietnamese text', () => {
    expect(constraint.validate('Phòng Công nghệ thông tin', {} as any)).toBe(
      true,
    );
  });

  it('should accept text with common separators', () => {
    expect(constraint.validate('Research & Development (R&D)', {} as any)).toBe(
      true,
    );
  });

  it('should reject emoji', () => {
    expect(constraint.validate('Test 😊', {} as any)).toBe(false);
  });

  it('should reject control characters', () => {
    expect(constraint.validate('Test\u0000Department', {} as any)).toBe(false);
  });

  it('should reject HTML tags', () => {
    expect(
      constraint.validate('<script>alert("xss")</script>', {} as any),
    ).toBe(false);
  });

  it('should accept empty string', () => {
    expect(constraint.validate('', {} as any)).toBe(true);
  });

  it('should accept null', () => {
    expect(constraint.validate(null as any, {} as any)).toBe(true);
  });
});
