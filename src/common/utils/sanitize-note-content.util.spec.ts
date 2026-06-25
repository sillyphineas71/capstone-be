import { sanitizeNoteContent } from './sanitize-note-content.util.js';

describe('sanitizeNoteContent', () => {
  it('should strip <script> tags with content', () => {
    const input = '<script>alert(1)</script>Hello';
    const result = sanitizeNoteContent(input);
    expect(result).toBe('Hello');
  });

  it('should strip <iframe> tags with content', () => {
    const input = '<iframe src="malicious"></iframe>Safe text';
    const result = sanitizeNoteContent(input);
    expect(result).toBe('Safe text');
  });

  it('should remove event handlers', () => {
    const input = '<div onclick="evil()">Click</div>';
    const result = sanitizeNoteContent(input);
    expect(result).toBe('<div>Click</div>');
  });

  it('should remove javascript: from href', () => {
    const input = '<a href="javascript:alert(1)">Link</a>';
    const result = sanitizeNoteContent(input);
    // Entire href attribute with javascript: is removed
    expect(result).toBe('<a>Link</a>');
  });

  it('should keep safe Markdown', () => {
    const input = '**bold** and _italic_ and code';
    const result = sanitizeNoteContent(input);
    expect(result).toBe('**bold** and _italic_ and code');
  });

  it('should keep safe text intact', () => {
    const input = 'Hello, this is a normal note!';
    const result = sanitizeNoteContent(input);
    expect(result).toBe('Hello, this is a normal note!');
  });

  it('should strip nested script tags', () => {
    const input = '<div><script>nested</script>Content</div>';
    const result = sanitizeNoteContent(input);
    expect(result).toBe('<div>Content</div>');
  });

  it('should strip style tags', () => {
    const input = '<style>body{color:red}</style>Text';
    const result = sanitizeNoteContent(input);
    expect(result).toBe('Text');
  });

  it('should return empty string for null/undefined input', () => {
    expect(sanitizeNoteContent('')).toBe('');
    expect(sanitizeNoteContent(null as unknown as string)).toBe('');
    expect(sanitizeNoteContent(undefined as unknown as string)).toBe('');
  });

  it('should trim result', () => {
    const input = '  <script>x</script>Hello  ';
    const result = sanitizeNoteContent(input);
    expect(result).toBe('Hello');
  });
});
