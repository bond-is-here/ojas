// A bounded, non-evaluating XML reader. DTDs and entities are never resolved.
// Comments/CDATA can be arbitrarily large without retaining their contents.
export async function* xmlTags(
  chunks: AsyncIterable<string>,
): AsyncGenerator<string> {
  let buffer = '';
  let mode: 'text' | 'tag' | 'comment' | 'cdata' = 'text';
  let cursor = 0;
  let quote = '';
  let subset = 0;
  let dtdComment = false;
  for await (const chunk of chunks) {
    buffer += chunk;
    while (buffer) {
      if (mode === 'text') {
        const start = buffer.indexOf('<');
        if (start < 0) {
          if (buffer.trim()) yield buffer;
          buffer = '';
          break;
        }
        if (buffer.slice(0, start).trim()) yield buffer.slice(0, start);
        buffer = buffer.slice(start);
        mode = 'tag';
        cursor = 1;
        quote = '';
        subset = 0;
        dtdComment = false;
      }
      if (mode === 'comment' || mode === 'cdata') {
        const ending = mode === 'comment' ? '-->' : ']]>';
        const end = buffer.indexOf(ending);
        if (end < 0) {
          buffer = buffer.slice(-2);
          break;
        }
        buffer = buffer.slice(end + 3);
        mode = 'text';
        continue;
      }
      // Wait until a declaration's prefix can be identified, including split chunks.
      if (buffer.startsWith('<!') && buffer.length < 9) break;
      if (buffer.startsWith('<!--')) {
        buffer = buffer.slice(4);
        mode = 'comment';
        continue;
      }
      if (buffer.startsWith('<![CDATA[')) {
        yield '<![CDATA[]]>';
        buffer = buffer.slice(9);
        mode = 'cdata';
        continue;
      }
      const doctype = buffer.startsWith('<!DOCTYPE');
      let complete = false;
      for (; cursor < buffer.length; cursor++) {
        const char = buffer[cursor];
        if (dtdComment) {
          const end = buffer.indexOf('-->', cursor);
          if (end < 0) {
            cursor = Math.max(cursor, buffer.length - 2);
            break;
          }
          cursor = end + 2;
          dtdComment = false;
          continue;
        }
        if (quote) {
          if (char === quote) quote = '';
          continue;
        }
        if (doctype && char === '<') {
          if (
            buffer.length - cursor < 4 &&
            '<!--'.startsWith(buffer.slice(cursor))
          )
            break;
          if (buffer.startsWith('<!--', cursor)) {
            dtdComment = true;
            cursor += 3;
            continue;
          }
        }
        if (char === '"' || char === "'") {
          quote = char;
          continue;
        }
        if (doctype && char === '[') subset++;
        if (doctype && char === ']') subset--;
        if (char === '>' && subset === 0) {
          complete = true;
          break;
        }
      }
      if (cursor > (doctype ? 1048576 : 16384))
        throw new Error('The XML file contains an oversized or invalid tag.');
      if (!complete) break;
      yield buffer.slice(0, cursor + 1);
      buffer = buffer.slice(cursor + 1);
      mode = 'text';
    }
  }
  if (mode !== 'text' || buffer.trim())
    throw new Error(
      'This export is incomplete. Choose the complete export.xml file.',
    );
}

export function xmlAttributes(tag: string): Record<string, string> {
  const values: Record<string, string> = Object.create(null);
  const name = /^<([\w:.-]+)/.exec(tag);
  if (!name) throw new Error('The XML file contains an invalid element.');
  let remaining = tag.slice(name[0].length).replace(/\/?\s*>$/, '');
  while (remaining.trim()) {
    const attribute = /^\s+([\w:.-]+)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(
      remaining,
    );
    if (!attribute || attribute[1] in values)
      throw new Error('The XML file contains invalid attributes.');
    const value = attribute[2] ?? attribute[3];
    if (value.length > 4096)
      throw new Error('The XML file contains an oversized attribute.');
    let invalidCharacter = false;
    for (const character of value) {
      const code = character.codePointAt(0)!;
      if (
        (code < 32 && ![9, 10, 13].includes(code)) ||
        code === 0xfffe ||
        code === 0xffff
      ) {
        invalidCharacter = true;
        break;
      }
    }
    if (
      invalidCharacter ||
      /&(?!amp;|quot;|apos;|lt;|gt;|#\d+;|#x[\da-fA-F]+;)/.test(value)
    )
      throw new Error('The XML file contains an invalid character or entity.');
    values[attribute[1]] = value.replace(
      /&(#x[\da-fA-F]+|#\d+|amp|quot|apos|lt|gt);/g,
      (_, entity: string) => {
        if (entity[0] === '#') {
          const code =
            entity[1].toLowerCase() === 'x'
              ? parseInt(entity.slice(2), 16)
              : Number(entity.slice(1));
          if (
            (code < 32 && ![9, 10, 13].includes(code)) ||
            code > 0x10ffff ||
            (code >= 0xd800 && code <= 0xdfff) ||
            code === 0xfffe ||
            code === 0xffff
          )
            throw new Error('The XML file contains an invalid character.');
          return String.fromCodePoint(code);
        }
        return (
          (
            { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' } as Record<
              string,
              string
            >
          )[entity] ?? ''
        );
      },
    );
    remaining = remaining.slice(attribute[0].length);
  }
  return values;
}
