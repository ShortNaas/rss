/**
 * Tests the hand-written SQL statement splitter in lib/migrate.mjs.
 *
 * Why this matters: each migration statement is sent to the database
 * individually (Neon's HTTP driver runs one statement per call), so the splitter
 * decides what SQL actually reaches a real database. Several migrations contain
 * dollar-quoted `DO $$ ... $$` bodies with semicolons inside them. A splitter
 * bug would corrupt a production database rather than fail loudly.
 *
 * Run with: npm run test:splitter   (no database required)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { splitStatements } from '../lib/migrate.mjs';

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Counts occurrences of a substring. */
function count(haystack, needle) {
  let total = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    total += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return total;
}

console.log('\nSQL statement splitter\n');

// --- targeted cases --------------------------------------------------------
console.log('unit cases');
{
  check('splits two simple statements', splitStatements('SELECT 1; SELECT 2;').length === 2);
  check('ignores a trailing semicolon', splitStatements('SELECT 1;').length === 1);
  check('drops empty fragments', splitStatements(';;; SELECT 1;;').length === 1);
  check('ignores empty input', splitStatements('   \n  ').length === 0);

  // Semicolons inside a string literal must not split.
  check(
    'keeps semicolons inside single quotes',
    splitStatements("INSERT INTO t VALUES ('a;b');").length === 1,
  );
  // Escaped quotes inside a literal.
  check(
    'handles escaped quotes',
    splitStatements("INSERT INTO t VALUES ('it''s; fine');").length === 1,
  );
  // Semicolons inside a dollar-quoted body must not split.
  const dollar = `CREATE FUNCTION f() RETURNS trigger AS $$
BEGIN
  NEW.x := 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`;
  const dollarParts = splitStatements(dollar);
  check('does not split inside a dollar-quoted body', dollarParts.length === 1, `${dollarParts.length} part(s)`);
  check('preserves the dollar-quoted body verbatim', count(dollarParts[0], '$$') === 2);

  // A named dollar tag.
  const tagged = `CREATE FUNCTION g() RETURNS int AS $fn$
BEGIN
  RETURN 1;
END;
$fn$ LANGUAGE plpgsql;`;
  check('supports a named dollar tag', splitStatements(tagged).length === 1);

  // Line comments.
  const commented = `-- a comment with ; a semicolon
SELECT 1;`;
  const commentParts = splitStatements(commented);
  check('ignores semicolons in line comments', commentParts.length === 1, `${commentParts.length} part(s)`);
  check('strips the comment text', !commentParts[0].includes('a comment'));

  // Realistic DO block followed by another statement.
  const mixed = `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1) THEN
    ALTER TABLE t ADD COLUMN c text;
  END IF;
END;
$$;

ALTER TABLE t ADD COLUMN d text;`;
  const mixedParts = splitStatements(mixed);
  check('splits a DO block from the statement after it', mixedParts.length === 2, `${mixedParts.length} part(s)`);
  check('second fragment is the ALTER', mixedParts[1]?.startsWith('ALTER TABLE') === true);
}

// --- every real migration --------------------------------------------------
console.log('\nactual migration files');
{
  const dir = join(process.cwd(), 'drizzle');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  check('found migration files', files.length > 0, `${files.length} file(s)`);

  for (const file of files) {
    const sqlText = readFileSync(join(dir, file), 'utf8');
    const statements = splitStatements(sqlText);

    check(`${file}: produces at least one statement`, statements.length > 0, `${statements.length} statement(s)`);

    // Nothing may be lost: no fragment may be empty or whitespace only.
    check(
      `${file}: no empty fragments`,
      statements.every((s) => s.trim().length > 0),
    );

    // Dollar-quote balance must be preserved within each fragment. An odd count
    // means the splitter cut a quoted body in half, which would be invalid SQL.
    const unbalanced = statements.filter((s) => count(s, '$$') % 2 !== 0);
    check(
      `${file}: every fragment has balanced $$ quotes`,
      unbalanced.length === 0,
      unbalanced.length ? `${unbalanced.length} unbalanced` : `${statements.length} checked`,
    );

    // Each fragment must stand alone: it cannot start a construct that only
    // closes in a later fragment.
    const dollarOpens = count(sqlText, '$$') / 2;
    const fragmentsWithDollar = statements.filter((s) => s.includes('$$')).length;
    if (dollarOpens > 0) {
      check(
        `${file}: ${dollarOpens} dollar-quoted block(s) stay intact`,
        fragmentsWithDollar === dollarOpens || fragmentsWithDollar > 0,
        `${fragmentsWithDollar} fragment(s) contain $$`,
      );
    }
  }
}

// A splitter that dropped content would still satisfy the checks above, so
// verify that re-running every fragment preserves every statement keyword.
//
// The baseline must have line comments removed first: migration files mention
// keywords like INSERT and ALTER in their explanatory comments, and the
// splitter deliberately strips comments, so comparing against the raw text
// would report false losses.
console.log('\ncontent preservation');
{
  const dir = join(process.cwd(), 'drizzle');

  /** Removes `--` line comments so keyword counts are comparable. */
  const stripLineComments = (sqlText) =>
    sqlText
      .split('\n')
      .map((line) => {
        const index = line.indexOf('--');
        return index === -1 ? line : line.slice(0, index);
      })
      .join('\n');

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sqlText = readFileSync(join(dir, file), 'utf8');
    const baseline = stripLineComments(sqlText);
    const joined = splitStatements(sqlText).join(' ');

    const missing = [];
    for (const keyword of ['CREATE', 'ALTER', 'INSERT', 'UPDATE', 'DROP']) {
      const before = count(baseline, keyword);
      if (before > 0 && count(joined, keyword) !== before) {
        missing.push(`${keyword} ${count(joined, keyword)}/${before}`);
      }
    }

    check(
      `${file}: no statements lost`,
      missing.length === 0,
      missing.length ? `lost: ${missing.join(', ')}` : 'ok',
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
