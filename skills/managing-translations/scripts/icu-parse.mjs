// ICU MessageFormat parser, following the grammar of
// @formatjs/icu-messageformat-parser (what next-intl and react-intl use) with
// its defaults: tags on, an "other" branch required, skeletons checked.
// Node built-ins only.
//
// icuNames(src) returns the names a translation must keep: every argument at
// every depth, and every rich-text tag as "<name>". It throws a SyntaxError
// where formatjs reports an error.
//
//   message  := (text | argument | tag | "#" in a plural branch)*
//   argument := "{" name "}" | "{" name "," number|date|time ["," style] "}"
//             | "{" name "," plural|selectordinal ["," "offset:" int] branches "}"
//             | "{" name "," select "," branches "}"
//   branches := (key "{" message "}")+   with an "other" key
//   tag      := "<" tagName ">" message "</" tagName ">" | "<" tagName "/>"
// A "'" quotes the next {, }, <, > (and # in a plural branch) up to the next
// lone "'"; "''" is a quote. A "}" outside any argument, and a "<" not
// followed by a letter or "/", are plain text.

const SPACE = /\p{Pattern_White_Space}/u; // tab..CR, space, U+0085, U+200E, U+200F, U+2028, U+2029
const NOT_IDENT = /[\p{White_Space}\p{Pattern_Syntax}]/u;
const ALPHA = /[A-Za-z]/;
const TAG_CHAR = /[-.0-9_A-Za-z\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u037D\u037F-\u1FFF\u200C\u200D\u203F\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}]/u;
const SKELETON_SPACE = /[\t-\r \x85\u200E\u200F\u2028\u2029]/;
// Date and time skeleton fields; the lookahead skips quoted text.
const DATE_FIELD = /(?:[Eec]{1,6}|G{1,5}|[Qq]{1,5}|(?:[yYur]+|U{1,5})|[ML]{1,5}|d{1,2}|D{1,3}|F{1}|[abB]{1,5}|[hkHK]{1,2}|w{1,2}|W{1}|m{1,2}|s{1,2}|[zZOvVxX]{1,4})(?=([^']*'[^']*')*[^']*$)/g;
const DATE_UNSUPPORTED = /^[YuUrqQwWDFbBZOvVXx]/;

export function icuNames(src) {
  const s = [...src]; // code points
  let i = 0;
  const names = new Set();
  const fail = (why) => { throw new SyntaxError(`${why} at ${i}`); };
  const eof = () => i >= s.length;
  const at = (str) => s.slice(i, i + str.length).join('') === str;
  const space = () => { while (!eof() && SPACE.test(s[i])) i++; };
  const ident = () => { const start = i; while (!eof() && !NOT_IDENT.test(s[i])) i++; return s.slice(start, i).join(''); };
  const integer = () => {
    const start = i;
    if (s[i] === '+' || s[i] === '-') i++;
    const digits = i;
    while (!eof() && s[i] >= '0' && s[i] <= '9') i++;
    if (i === digits) fail('expected a number');
    return s.slice(start, i).join('');
  };
  const close = () => { if (s[i] !== '}') fail('expected }'); i++; };
  const counts = (type) => type === 'plural' || type === 'selectordinal';

  function message(depth, parentType, inTag) {
    while (!eof()) {
      const c = s[i];
      if (c === '{') argument(depth, inTag);
      else if (c === '}' && depth > 0) return;
      else if (c === '#' && counts(parentType)) i++;
      else if (c === '<' && s[i + 1] === '/') { if (inTag) return; fail('closing tag without an opening tag'); }
      else if (c === '<' && ALPHA.test(s[i + 1] ?? '')) tag(depth, parentType);
      else if (c === "'") quote(parentType);
      else i++;
    }
  }

  function quote(parentType) {
    const next = s[i + 1];
    if (next === "'") { i += 2; return; }
    if (!('{}<>'.includes(next ?? 'x') || (next === '#' && counts(parentType)))) { i++; return; }
    i += 2;
    while (!eof()) {
      if (s[i] === "'" && s[i + 1] === "'") i += 2;
      else if (s[i] === "'") { i++; return; }
      else i++;
    }
  }

  function tagName() { const start = i; i++; while (!eof() && TAG_CHAR.test(s[i])) i++; return s.slice(start, i).join(''); }

  function tag(depth, parentType) {
    i++; // <
    const name = tagName();
    space();
    if (at('/>')) { i += 2; return; } // self-closing: plain text to formatjs
    if (s[i] !== '>') fail(`bad tag <${name}`);
    i++;
    message(depth + 1, parentType, true);
    if (!at('</')) fail(`unclosed tag <${name}>`);
    i += 2;
    if (eof() || !ALPHA.test(s[i])) fail('bad closing tag');
    const closing = tagName();
    if (closing !== name) fail(`<${name}> closed by </${closing}>`);
    space();
    if (s[i] !== '>') fail('bad closing tag');
    i++;
    names.add(`<${name}>`);
  }

  function argument(depth, inTag) {
    i++; // {
    space();
    if (eof()) fail('unclosed argument');
    if (s[i] === '}') fail('empty argument');
    const name = ident();
    if (!name) fail('malformed argument');
    space();
    if (eof()) fail('unclosed argument');
    if (s[i] === '}') { i++; names.add(name); return; }
    if (s[i] !== ',') fail('malformed argument');
    i++;
    space();
    if (eof()) fail('unclosed argument');
    const type = ident();
    if (type === 'number' || type === 'date' || type === 'time') {
      space();
      let style = null;
      if (s[i] === ',') {
        i++;
        space();
        style = simpleStyle().trimEnd();
        if (!style) fail('expected a style');
      }
      close();
      if (style?.startsWith('::')) skeleton(type, style.slice(2).trimStart());
    } else if (type === 'plural' || type === 'selectordinal' || type === 'select') {
      space();
      if (s[i] !== ',') fail(`expected options for ${type}`);
      i++;
      space();
      let key = ident();
      if (type !== 'select' && key === 'offset') {
        if (s[i] !== ':') fail('expected an offset');
        i++;
        space();
        integer();
        space();
        key = ident();
      }
      branches(depth, type, inTag, key);
      close();
    } else fail(type ? `unknown argument type "${type}"` : 'expected an argument type');
    names.add(name);
  }

  function simpleStyle() {
    const start = i;
    for (let nested = 0; !eof(); ) {
      if (s[i] === "'") {
        i++;
        while (!eof() && s[i] !== "'") i++;
        if (eof()) fail('unclosed quote in style');
        i++;
      } else if (s[i] === '{') { nested++; i++; }
      else if (s[i] === '}') { if (!nested) break; nested--; i++; }
      else i++;
    }
    return s.slice(start, i).join('');
  }

  function branches(depth, type, inTag, key) {
    const seen = new Set();
    for (;;) {
      if (!key) {
        if (type === 'select' || s[i] !== '=') break;
        i++;
        key = `=${integer()}`;
      }
      if (seen.has(key)) fail(`duplicate branch "${key}"`);
      seen.add(key);
      space();
      if (s[i] !== '{') fail(`expected { after "${key}"`);
      i++;
      message(depth + 1, type, inTag);
      close();
      space();
      key = ident();
    }
    if (!seen.size) fail(`expected a ${type} branch`);
    if (!seen.has('other')) fail('missing "other" branch');
  }

  message(0, null, false);
  return names;
}

function skeleton(type, text) {
  if (type !== 'number') {
    if (!text) throw new SyntaxError('empty date or time skeleton');
    for (const [field] of text.matchAll(DATE_FIELD)) {
      if (DATE_UNSUPPORTED.test(field) || (/^[ec]/.test(field) && field.length < 4)) throw new SyntaxError(`unsupported date field "${field}"`);
    }
    return;
  }
  if (!text) throw new SyntaxError('empty number skeleton');
  for (const token of text.split(SKELETON_SPACE).filter(Boolean)) {
    const [stem, ...options] = token.split('/');
    const bad = (why) => { throw new SyntaxError(`number skeleton "${token}": ${why}`); };
    if (options.some((o) => !o)) bad('empty option');
    if (stem === 'integer-width') {
      if (options.length !== 1) bad('integer-width takes one option');
      for (const m of options[0].matchAll(/(\*)(0+)|(#+)(0+)|(0+)/g)) if (!m[1]) bad('unsupported integer width');
    } else if (/^0+$/.test(stem)) {
      // concise integer width
    } else if (/^\.(?:(0+)(\*)?|(#+)|(0+)(#+))$/.test(stem)) {
      if (options.length > 1) bad('fraction precision takes at most one option');
    } else if (stem.startsWith('E') && !/^EE?(\+!|\+\?)?0+$/.test(stem)) bad('malformed scientific notation');
  }
}
