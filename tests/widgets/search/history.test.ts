import { describe, expect, it } from 'vitest';
import { forget, matchHistory, MAX_HISTORY, parseHistory, remember } from '../../../src/widgets/search/history';
import { buildOptions, defaultKey } from '../../../src/widgets/search/options';

describe('search history', () => {
  it('puts the latest search first, keeps one copy of each word and at most ten', () => {
    let history: string[] = [];
    for (let i = 0; i < 12; i++) history = remember(history, `q${i}`);
    expect(history).toHaveLength(MAX_HISTORY);
    expect(history[0]).toBe('q11');
    expect(history.at(-1)).toBe('q2');

    history = remember(history, '  Ｑ5 ');
    expect(history[0]).toBe('Ｑ5');
    expect(history.filter((text) => text.toLowerCase().normalize('NFKC') === 'q5')).toHaveLength(1);
    expect(history).toHaveLength(MAX_HISTORY);
  });

  it('ignores blank, overlong or malformed words', () => {
    expect(remember(['a'], '   ')).toEqual(['a']);
    expect(remember(['a'], 'x'.repeat(201))).toEqual(['a']);
    expect(remember(['a'], 'bad\uD800')).toEqual(['a']);
  });

  it('reads stored history defensively', () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory('not json')).toEqual([]);
    expect(parseHistory('{"a":1}')).toEqual([]);
    expect(parseHistory(JSON.stringify(['a', 1, '', 'A', ' b ', ...Array.from({ length: 20 }, (_, i) => `x${i}`)]))).toEqual([
      'a',
      'b',
      ...Array.from({ length: 8 }, (_, i) => `x${i}`),
    ]);
  });

  it('forgets one entry', () => {
    expect(forget(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('matches entries that contain the query but are not the query itself', () => {
    const history = ['git rebase', 'Git', 'github actions', 'rust', 'git stash', 'gitlab'];
    expect(matchHistory(history, 'GIT')).toEqual(['git rebase', 'github actions', 'git stash']);
    expect(matchHistory(history, '  ')).toEqual([]);
  });
});

describe('search options with history', () => {
  it('lists the history alone when nothing is typed, with nothing preselected', () => {
    const options = buildOptions('', [], [], ['a', 'b']);
    expect(options.map((option) => option.kind)).toEqual(['history', 'history']);
    expect(defaultKey(options, '')).toBeUndefined();
  });

  it('puts matching history after the web search and drops suggestions that repeat it', () => {
    const options = buildOptions('git', [], ['git rebase', 'git merge'], ['git rebase', 'rust']);
    expect(options.map((option) => [option.kind, 'text' in option ? option.text : ''])).toEqual([
      ['web', 'git'],
      ['history', 'git rebase'],
      ['suggest', 'git merge'],
    ]);
    expect(defaultKey(options, 'git')).toBe('web');
  });
});
