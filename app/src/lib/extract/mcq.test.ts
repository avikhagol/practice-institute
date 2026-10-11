import { describe, expect, it } from 'vitest';
import { parseMcqDocument, parseMcqs, type ParseLine } from './mcq';

const L = (page: number, ...texts: string[]): ParseLine[] => texts.map((text) => ({ text, page }));

describe('parseMcqs', () => {
  it('parses (1)-(4) options on separate and wrapped lines', () => {
    const qs = parseMcqs('d1', [
      ...L(1, '1. Which of the following is the most suitable way to', 'assess learning of young children?'),
      ...L(1, '(1) Annual examinations only', '(2) Continuous and comprehensive', 'observation', '(3) Rote recall tests', '(4) Ranking students'),
      ...L(1, '2. A teacher should', '(1) punish (2) encourage (3) ignore (4) compare'),
    ]);
    expect(qs).toHaveLength(2);
    expect(qs[0]!.stem).toBe('Which of the following is the most suitable way to assess learning of young children?');
    expect(qs[0]!.options.map((o) => o.text)).toEqual([
      'Annual examinations only',
      'Continuous and comprehensive observation',
      'Rote recall tests',
      'Ranking students',
    ]);
    expect(qs[0]!.options.map((o) => o.key)).toEqual(['A', 'B', 'C', 'D']);
    expect(qs[0]!.options[0]!.sourceLabel).toBe('(1)');
    expect(qs[0]!.status).toBe('ok');
    expect(qs[1]!.options.map((o) => o.text)).toEqual(['punish', 'encourage', 'ignore', 'compare']);
    expect(qs.every((q) => q.answerKey === null)).toBe(true);
  });

  it('parses A. / B. labels and (a) statements inside stems', () => {
    const qs = parseMcqs('d1', [
      ...L(2, '7. Consider the statements: (a) Play aids learning (b) Errors are useful', '(1) Only (a) (2) Only (b) (3) Both (a) and (b) (4) Neither'),
      ...L(2, '8) Capital of India?', 'A. Mumbai', 'B. New Delhi', 'C. Kolkata', 'D. Chennai'),
    ]);
    expect(qs).toHaveLength(2);
    expect(qs[0]!.stem).toContain('(a) Play aids learning');
    expect(qs[0]!.options).toHaveLength(4);
    expect(qs[0]!.options[2]!.text).toBe('Both (a) and (b)');
    expect(qs[1]!.options.map((o) => o.text)).toEqual(['Mumbai', 'New Delhi', 'Kolkata', 'Chennai']);
  });

  it('preserves Hindi Unicode text', () => {
    const qs = parseMcqs('d1', L(3, '12. बच्चों के सीखने का आकलन कैसे करना चाहिए?', '(1) सतत (2) वार्षिक (3) मौखिक (4) लिखित'));
    expect(qs[0]!.stem).toBe('बच्चों के सीखने का आकलन कैसे करना चाहिए?');
    expect(qs[0]!.options[0]!.text).toBe('सतत');
  });

  it('flags missing options instead of inventing them', () => {
    const qs = parseMcqs('d1', L(1, '1. Incomplete question', '(1) only one', '(2) two'));
    expect(qs[0]!.options).toHaveLength(2);
    expect(qs[0]!.status).toBe('needs-review');
    expect(qs[0]!.warnings.some((w) => w.code === 'option-count' && w.blocking)).toBe(true);
  });

  it('flags a duplicated (bilingual) option set and keeps only the first', () => {
    const qs = parseMcqs('d1', L(1, '3. Pedagogy means / शिक्षाशास्त्र का अर्थ है', '(1) a (2) b (3) c (4) d (1) क (2) ख (3) ग (4) घ'));
    expect(qs[0]!.options.map((o) => o.text)).toEqual(['a', 'b', 'c', 'd']);
    expect(qs[0]!.warnings.map((w) => w.code)).toContain('bilingual-duplicate');
    expect(qs[0]!.status).toBe('needs-review');
  });

  it('drops a verbatim repeated option set without blocking the question', () => {
    // Real CTET maths items: the Hindi copy's legacy-font text is hidden, leaving identical numeric options.
    const qs = parseMcqs('d1', L(1, '45. 22 hm 8 dam is equal to :', '(1) 22800 m (2) 2208 m (3) 2280 m (4) 22080 m', '(1) 22800 m (2) 2208 m (3) 2280 m (4) 22080 m'));
    expect(qs[0]!.options.map((o) => o.text)).toEqual(['22800 m', '2208 m', '2280 m', '22080 m']);
    const w = qs[0]!.warnings.find((x) => x.code === 'bilingual-duplicate')!;
    expect(w.blocking).toBe(false);
    expect(qs[0]!.status).toBe('ok');
  });

  it('keeps option cross-references such as "Both (1) and (3)" inside the option', () => {
    const qs = parseMcqs('d1', [
      ...L(1, '1. The narrator left because....', '(1) weary (2) keen to travel (3) not lazy (4) Both (1) and (3)'),
      ...L(1, '2. Which is not correct ?', '(1) dark spot (2) only Pat (3) both (1) and (2) (4) the cold'),
    ]);
    expect(qs[0]!.options.map((o) => o.text)).toEqual(['weary', 'keen to travel', 'not lazy', 'Both (1) and (3)']);
    expect(qs[1]!.options.map((o) => o.text)).toEqual(['dark spot', 'only Pat', 'both (1) and (2)', 'the cold']);
    expect(qs.every((q) => q.status === 'ok' && q.warnings.length === 0)).toBe(true);
  });

  it('flags punctuation-only options from stacked fractions as unreadable', () => {
    const qs = parseMcqs('d1', L(1, '34. Arrange the fractions in decreasing order :', '(1) , , , (2) , , , (3) , , , (4) , , , 7 9 63'));
    expect(qs[0]!.warnings.some((w) => w.code === 'empty-option' && w.blocking)).toBe(true);
    expect(qs[0]!.status).toBe('needs-review');
  });

  it('bounds "Read the extract ... (100 to 100)" passages and stops at the end-of-paper mark', () => {
    const passage = 'An extract of verse that is long enough to count as a shared passage. '.repeat(4);
    const qs = parseMcqs('d1', [
      ...L(1, '99. Identify the device.', '(1) Simile (2) Metaphor (3) Irony (4) Pun'),
      ...L(1, 'Read the extract given below and answer the questions that follow : (100 to 100)', passage),
      ...L(1, '100. The poet means (1) a (2) b (3) c (4) d'),
      ...L(1, '101. A pedagogy item (1) a (2) b (3) c (4) d'),
      ...L(2, '- o 0 o -', 'answering the questions. to be changed.'),
    ]);
    expect(qs[0]!.options[3]!.text).toBe('Pun');
    expect(qs[1]!.context).toContain('An extract of verse');
    expect(qs[2]!.context).toBeNull();
    expect(qs[2]!.options[3]!.text).toBe('d');
    expect(qs[2]!.pageEnd).toBe(1);
  });

  it('does not treat ordinary words like "bar graph" or "picture stories" as missing figures', () => {
    const qs = parseMcqs('d1', [
      ...L(1, '1. A bar graph displays data; textbooks use picture stories. (1) a (2) b (3) c (4) d'),
      ...L(1, '2. Study the following graph and answer. (1) a (2) b (3) c (4) d'),
    ]);
    expect(qs[0]!.warnings.map((w) => w.code)).not.toContain('diagram-reference');
    expect(qs[1]!.warnings.map((w) => w.code)).toContain('diagram-reference');
  });

  it('attaches passage directions to the stated question range', () => {
    const qs = parseMcqs('d1', [
      ...L(1, '1. Q one (1) a (2) b (3) c (4) d'),
      ...L(
        1,
        'Directions: Read the passage and answer Q. Nos. 2 to 3.',
        'The river flows quietly through the valley. Farmers on both banks depend on it for water,',
        'and children learn to swim in its shallow bends during the long, warm summer afternoons each year.',
      ),
      ...L(1, '2. What flows? (1) river (2) wind (3) sand (4) light'),
      ...L(2, '3. Where? (1) valley (2) hill (3) sea (4) sky'),
      ...L(2, '4. Unrelated (1) w (2) x (3) y (4) z'),
    ]);
    expect(qs.map((q) => q.number)).toEqual([1, 2, 3, 4]);
    expect(qs[0]!.context).toBeNull();
    expect(qs[0]!.options[3]!.text).toBe('d');
    expect(qs[1]!.context).toContain('river flows');
    expect(qs[2]!.context).toContain('river flows');
    expect(qs[3]!.context).toBeNull();
  });

  it('ignores out-of-sequence numbers and records gaps', () => {
    const qs = parseMcqs('d1', [
      ...L(1, '1. First (1) a (2) b (3) c (4) d'),
      ...L(1, '2017. not a question number'),
      ...L(1, '3. Third (1) a (2) b (3) c (4) d'),
    ]);
    expect(qs.map((q) => q.number)).toEqual([1, 3]);
    expect(qs[1]!.warnings.map((w) => w.code)).toContain('numbering-gap');
  });

  it('records page provenance across page breaks and diagram references', () => {
    const qs = parseMcqs('d1', [...L(4, '5. Study the figure shown below and answer'), ...L(5, '(1) p (2) q (3) r (4) s')]);
    expect(qs[0]!.page).toBe(4);
    expect(qs[0]!.pageEnd).toBe(5);
    expect(qs[0]!.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['spans-pages', 'diagram-reference']));
  });

  it('drops a numbered cover-instruction section that has no options', () => {
    const r = parseMcqDocument('d1', [
      ...L(1, '1. Use only blue/black ball point pen.', '2. Do not fold the answer sheet.', '3. Rough work only in the booklet.', '4. No electronic devices.', '5. Hand over the sheet.', '6. Marks are not deducted.'),
      ...L(2, 'PART - I', 'Direction : Answer the following questions (Q. Nos 1 to 30) by selecting the most appropriate option.'),
      ...L(2, '1. First real (1) a (2) b (3) c (4) d', '2. Second real (1) a (2) b (3) c (4) d'),
      ...L(2, 'SPACE FOR ROUGH WORK'),
    ]);
    expect(r.questions.map((q) => q.stem)).toEqual(['First real', 'Second real']);
    expect(r.questions[0]!.context).toBeNull();
    expect(r.questions[1]!.options[3]!.text).toBe('d');
    expect(r.discardedBlocks).toBe(6);
  });

  it('returns no questions for prose', () => {
    expect(parseMcqs('d1', L(1, 'This is an ordinary article.', 'It has no numbered questions.'))).toEqual([]);
  });
});
