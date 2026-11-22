// A faster drop-in for csv-reader 1.0.0: run(input) returns exactly the answer csv-reader 1.0.0
// returns for every input {text, header} — {columns, rows, errors} — by the same written policy:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled, "" inside it one
//     quote, and each CRLF or lone CR inside it read as LF; what follows its closing quote, up to
//     the next comma or line break, is appended as it stands (quote_junk, when the field ends); a
//     quote that never closes is a literal character and the text after it is read again as
//     unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings;
//   - columns is the first record when header is true, else null; rows holds the records after it,
//     each padded with "" (short_row, with fields: its count) or cut (long_row, with extra: the
//     cut fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts on (every LF, CRLF
//     and lone CR inside quotes counted), row its record's index in rows, null for the header.
//
// Where csv-reader walks one character at a time and builds each field a character at a time, this
// reader scans with indexOf: a field is cut out in whole slices between the special characters
// (comma, LF, CR, quote), and only the characters that change the reading — a stray CR, a CR inside
// quotes, a doubled quote — break a slice. The readings are the same; the work per character is not.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the next.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, and how many characters the last read added.
  let fVal = '';
  let fEnd = END;
  let fAdded = 0;

  // The index of the next CR at or after the point it was last computed for. pos only ever moves
  // forward, so one cached index serves every read: a fresh indexOf for a character as rare as CR
  // would rescan the whole gap to the next one for every field in between.
  let crNext = -2;
  function nextCr(from) {
    if (crNext === -1) return -1;
    if (crNext < from) crNext = text.indexOf('\r', from);
    return crNext;
  }

  // Reads unquoted characters onto `prefix` up to the next comma or line break: a CR not followed
  // by LF is dropped (stray_cr). Sets fVal, fEnd and fAdded (the characters kept past `prefix`).
  function readUnquoted(prefix) {
    let value = prefix;
    let seg = pos;
    let i = pos;
    for (;;) {
      const a = text.indexOf(',', i);
      const b = text.indexOf('\n', i);
      const c = nextCr(i);
      let d = a;
      let dc = 44;
      if (b !== -1 && (d === -1 || b < d)) { d = b; dc = 10; }
      if (c !== -1 && (d === -1 || c < d)) { d = c; dc = 13; }
      if (d === -1) {
        if (len > seg) value += text.slice(seg, len);
        pos = len;
        fVal = value;
        fEnd = END;
        break;
      }
      if (dc === 44) {
        if (d > seg) value += text.slice(seg, d);
        pos = d + 1;
        fVal = value;
        fEnd = COMMA;
        break;
      }
      if (dc === 10) {
        if (d > seg) value += text.slice(seg, d);
        pos = d + 1;
        line += 1;
        fVal = value;
        fEnd = LINE_BREAK;
        break;
      }
      // dc === 13: a CR.
      if (text.charCodeAt(d + 1) === 10) {
        if (d > seg) value += text.slice(seg, d);
        pos = d + 2;
        line += 1;
        fVal = value;
        fEnd = LINE_BREAK;
        break;
      }
      // A stray CR: the slice before it is kept, the CR is dropped, the read goes on.
      if (d > seg) value += text.slice(seg, d);
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      i = d + 1;
      seg = d + 1;
    }
    fAdded = value.length - prefix.length;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fVal and fEnd.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let seg = pos;
    let value = '';
    let closed = false;
    for (;;) {
      const a = text.indexOf('"', pos);
      const b = text.indexOf('\n', pos);
      const c = nextCr(pos);
      let d = a;
      let dc = 34;
      if (b !== -1 && (d === -1 || b < d)) { d = b; dc = 10; }
      if (c !== -1 && (d === -1 || c < d)) { d = c; dc = 13; }
      if (d === -1) {
        pos = len;
        break; // the quote never closes
      }
      if (dc === 10) {
        // An LF inside quotes stays in the value as it stands; only the line count moves.
        line += 1;
        pos = d + 1;
        continue;
      }
      if (dc === 13) {
        // A CRLF or a lone CR inside quotes is read as one LF.
        if (d > seg) value += text.slice(seg, d);
        value += '\n';
        line += 1;
        pos = text.charCodeAt(d + 1) === 10 ? d + 2 : d + 1;
        seg = pos;
        continue;
      }
      // dc === 34: a quote.
      if (text.charCodeAt(d + 1) === 34) {
        if (d > seg) value += text.slice(seg, d);
        value += '"';
        pos = d + 2;
        seg = pos;
        continue;
      }
      if (d > seg) value += text.slice(seg, d);
      pos = d + 1;
      closed = true;
      break;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it is read again
      // as unquoted. pos moves backward here — the one place it does — so the cached CR index,
      // which the failed scan may have advanced past CRs the re-read must meet again, is dropped.
      pos = open + 1;
      line = openLine;
      crNext = -2;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      readUnquoted('"');
      return;
    }
    if (pos >= len) {
      fVal = value;
      fEnd = END;
      return;
    }
    const ch = text[pos];
    if (ch === ',') {
      pos += 1;
      fVal = value;
      fEnd = COMMA;
      return;
    }
    if (ch === '\n') {
      pos += 1;
      line += 1;
      fVal = value;
      fEnd = LINE_BREAK;
      return;
    }
    if (ch === '\r' && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fVal = value;
      fEnd = LINE_BREAK;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    readUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const ch = text[pos];
      if (ch === '\n') {
        pos += 1;
        line += 1;
      } else if (ch === '\r' && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      quoted = text[pos] === '"';
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fVal);
    } while (fEnd === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
