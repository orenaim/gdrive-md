import { describe, expect, it } from 'vitest';
import { renderInlineMarkdown } from './inlineRender';

function render(markdown: string): HTMLElement {
  const host = document.createElement('div');
  host.appendChild(renderInlineMarkdown(markdown));
  return host;
}

describe('renderInlineMarkdown', () => {
  it('renders bold without showing its markers', () => {
    const el = render('**data**');
    expect(el.querySelector('strong')?.textContent).toBe('data');
    expect(el.textContent).toBe('data');
  });

  it('renders italic, strikethrough and inline code', () => {
    expect(render('*a*').querySelector('em')?.textContent).toBe('a');
    expect(render('~~a~~').querySelector('del')?.textContent).toBe('a');
    expect(render('`a`').querySelector('code')?.textContent).toBe('a');
  });

  it('renders a link as its label, carrying the target', () => {
    const el = render('[data.md](https://example.com/data.md)');
    const a = el.querySelector('a');
    expect(a?.textContent).toBe('data.md');
    expect(a?.getAttribute('data-href')).toBe('https://example.com/data.md');
    expect(el.textContent).toBe('data.md');
  });

  it('refuses to make a javascript: URL clickable', () => {
    // Table cells come from a document other people can edit, so an href is
    // untrusted input.
    const a = render('[click](javascript:alert(1))').querySelector('a');
    expect(a?.textContent).toBe('click');
    expect(a?.getAttribute('data-href')).toBeNull();
  });

  it('handles mixed content and nesting', () => {
    const el = render('see **bold `code`** and *more*');
    expect(el.textContent).toBe('see bold code and more');
    expect(el.querySelector('strong code')?.textContent).toBe('code');
  });

  it('shows an escaped character without its backslash', () => {
    expect(render('a \\* b').textContent).toBe('a * b');
  });

  it('leaves syntax it does not model as literal text', () => {
    // The same rule the live preview follows in body text: never drop what we
    // do not understand.
    expect(render('{{ mustache }}').textContent).toBe('{{ mustache }}');
    expect(render('[[wikilink]]').textContent).toBe('[[wikilink]]');
  });

  it('keeps a relative image as source rather than a broken image', () => {
    const el = render('![alt](assets/x.png)');
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe('![alt](assets/x.png)');
  });

  it('renders an absolute image', () => {
    const img = render('![alt](https://example.com/x.png)').querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://example.com/x.png');
    expect(img?.getAttribute('alt')).toBe('alt');
  });

  it('renders empty and plain text safely', () => {
    expect(render('').textContent).toBe('');
    expect(render('just text').textContent).toBe('just text');
  });

  it('does not execute HTML in cell content', () => {
    // Everything is built with createElement/createTextNode; nothing is ever
    // assigned to innerHTML.
    const el = render('<img src=x onerror=alert(1)>');
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img');
  });
});
