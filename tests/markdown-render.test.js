'use strict';

const { renderMarkdown } = require('../src/markdown-render');

describe('markdown-render', () => {
  let originalTTY;
  let originalTerm;
  let originalNoColor;
  beforeAll(() => {
    originalTTY = process.stdout.isTTY;
    originalTerm = process.env.TERM;
    originalNoColor = process.env.NO_COLOR;
    process.stdout.isTTY = true;
    process.env.TERM = 'xterm';
    delete process.env.NO_COLOR;
  });
  afterAll(() => {
    process.stdout.isTTY = originalTTY;
    process.env.TERM = originalTerm;
    if (originalNoColor !== undefined) {
      process.env.NO_COLOR = originalNoColor;
    }
  });

  test('returns array', () => {
    const result = renderMarkdown('hello');
    expect(Array.isArray(result)).toBe(true);
  });

  test('returns empty array for empty/null input', () => {
    expect(renderMarkdown(null)).toEqual([]);
    expect(renderMarkdown('')).toEqual([]);
  });

  test('a # Header line produces an uppercased, bold-cyan-wrapped line plus underline', () => {
    const result = renderMarkdown('# Hello World');
    // Result contains empty line, header text, and underline
    expect(result.length).toBeGreaterThanOrEqual(3);
    // Should have bold and lcyan ANSI codes
    expect(result[1]).toContain('\x1b[1m\x1b[96mHELLO WORLD\x1b[0m');
  });

  test('a **bold** inline segment gets wrapped in bold ANSI codes', () => {
    const result = renderMarkdown('This is **bold** text');
    expect(result[0]).toContain('\x1b[1m\x1b[37mbold\x1b[0m');
  });

  test('a `code` inline segment gets wrapped in a distinct color', () => {
    const result = renderMarkdown('Use `npm install`');
    expect(result[0]).toContain('\x1b[93mnpm install\x1b[0m');
  });

  test('a fenced ```code block``` produces top border, content lines, bottom border', () => {
    const result = renderMarkdown('```js\nconst x = 1;\n```');
    expect(result[0]).toContain('┌─ js');
    expect(result[1]).toContain('const x = 1;');
    expect(result[2]).toContain('└─');
  });

  test('a - bullet line is prefixed with a styled bullet character', () => {
    const result = renderMarkdown('- first item');
    expect(result[0]).toContain('•');
    expect(result[0]).toContain('first item');
  });

  test('a 1. numbered line is prefixed with the number, styled', () => {
    const result = renderMarkdown('1. first item');
    expect(result[0]).toContain('1.');
    expect(result[0]).toContain('first item');
  });

  test('long plain paragraph lines get word-wrapped to fit terminal width', () => {
    const longText = 'This is a very long paragraph that should definitely exceed the terminal width of any reasonably sized terminal window assuming the terminal window is set to a normal size like 80 columns or so because it just keeps going and going.';
    const result = renderMarkdown(longText);
    expect(result.length).toBeGreaterThan(1);
  });

  test('module never throws for malformed/unterminated code fences', () => {
    const malformed = '```\nconst x = 1;';
    expect(() => renderMarkdown(malformed)).not.toThrow();
    const result = renderMarkdown(malformed);
    expect(result[result.length - 1]).toContain('└─'); // Should self-terminate
  });

  test('blank lines in input produce blank lines in output', () => {
    const result = renderMarkdown('Line 1\n\nLine 2');
    expect(result.length).toBe(3);
    expect(result[1]).toBe('');
  });

  test('mixed content parses without throwing and produces a non-empty result', () => {
    const mixed = '# Title\n\n- Item 1\n- Item 2\n\n```python\nprint("Hello")\n```\n\nSome **bold** text.';
    expect(() => renderMarkdown(mixed)).not.toThrow();
    const result = renderMarkdown(mixed);
    expect(result.length).toBeGreaterThan(5);
  });
});
