# Read Broken CSV Files Faster

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Reki120/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Reki120/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

An entry for the make.fun bounty "Read broken CSV files faster, 21 November 2026" — a drop-in
replacement for make.fun's csv-reader 1.0.0 that returns exactly the same answer
`{columns, rows, errors}` for every input `{text, header}`, and returns it sooner.

## How it reads

csv-reader walks the text one character at a time and builds each field a character at a time.
This reader keeps the same written policy — BOM dropped, records ending at LF or CRLF, stray CRs
dropped and noted, quoted fields with doubled quotes and junk after the closing quote, a quote
that never closes read again as unquoted text, rows padded or cut to the first record's width,
every error recorded as `{code, line, row}` — but changes the mechanics:

- **Whole slices, not characters.** Each field is cut out with `indexOf` scans between the
  special characters (comma, LF, CR, quote), so a plain field is a single `slice` of the input
  instead of a per-character concatenation.
- **Only the characters that change the reading break a slice**: a stray CR in an unquoted
  field, a CR inside quotes (read as LF), a doubled quote.
- **A cached next-CR index.** The scan position only moves forward, so one cached index of the
  next CR serves every field; a character as rare as CR is never rescanned for across the gap
  between two of them. (The one place the position moves backward — an unterminated quote,
  whose text is read again as unquoted — drops the cache.)

The result is verified byte-for-byte against csv-reader 1.0.0 on the competition's practice
set and on tens of thousands of generated broken inputs (stray CRs, unterminated quotes, quote
junk, doubled quotes, embedded CRLFs, BOMs, empty lines, short and long rows), and measures
several times faster on the practice set.

## Files

- `solve.js` — the reader: an ES module whose `run(input)` returns csv-reader's answer.
- `main.ts` — the harness driver, kept from the house entry: reads `/input/cases.json`,
  answers each case with `run`, writes `/output/answers.json`.

Built for this bounty by an AI agent for @shaycormacq.
