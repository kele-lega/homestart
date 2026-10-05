import { describe, expect, it } from 'vitest';
import {
  CLOSED,
  hold,
  pin,
  preview,
  relayout,
  toggle,
  unpreview,
  type MenuState,
} from '../../../src/widgets/link-groups/menu';

const previewing = (id: string): MenuState => ({ open: [id], pinned: false });
const pinnedOn = (id: string): MenuState => ({ open: [id], pinned: true });

describe('link-groups menu (popover mode)', () => {
  it('previews one group at a time on hover', () => {
    expect(preview(CLOSED, 'dev')).toEqual(previewing('dev'));
    expect(preview(previewing('dev'), 'ai')).toEqual(previewing('ai'));
  });

  it('returns the same state when the hovered group is already previewed', () => {
    const state = previewing('dev');
    expect(preview(state, 'dev')).toBe(state);
  });

  it('closes a preview when the pointer leaves, but not a pinned group', () => {
    expect(unpreview(previewing('dev'))).toEqual(CLOSED);
    expect(unpreview(pinnedOn('dev'))).toEqual(pinnedOn('dev'));
  });

  it('ignores hover while a group is pinned', () => {
    expect(preview(pinnedOn('dev'), 'ai')).toEqual(pinnedOn('dev'));
  });

  it('pins on click, switches the pin to another group, and unpins on a second click', () => {
    expect(pin(CLOSED, 'dev')).toEqual(pinnedOn('dev'));
    expect(pin(previewing('dev'), 'dev')).toEqual(pinnedOn('dev'));
    expect(pin(pinnedOn('dev'), 'ai')).toEqual(pinnedOn('ai'));
    expect(pin(pinnedOn('dev'), 'dev')).toEqual(CLOSED);
  });

  it('holds a preview open once focus moves into it, without toggling a pinned group', () => {
    expect(hold(previewing('dev'), 'dev')).toEqual(pinnedOn('dev'));
    const pinned = pinnedOn('dev');
    expect(hold(pinned, 'dev')).toBe(pinned);
    expect(hold(CLOSED, 'dev')).toBe(CLOSED);
  });

  it('only holds the group that focus actually entered', () => {
    const state = previewing('fun');
    expect(hold(state, 'work')).toBe(state);
  });
});

describe('link-groups menu (crossing the breakpoint)', () => {
  it('keeps the group that holds focus open, so focus never lands in a hidden panel', () => {
    expect(relayout(pinnedOn('dev'), 'dev', false)).toEqual({ open: ['dev'], pinned: false });
    expect(relayout({ open: ['dev', 'ai'], pinned: false }, 'ai', true)).toEqual(pinnedOn('ai'));
  });

  it('closes everything when focus is not inside an open group', () => {
    expect(relayout(pinnedOn('dev'), undefined, false)).toBe(CLOSED);
    expect(relayout(previewing('dev'), 'ai', true)).toBe(CLOSED);
  });
});

describe('link-groups menu (accordion mode)', () => {
  it('toggles groups independently so opening one never moves another', () => {
    const one = toggle(CLOSED, 'dev');
    const two = toggle(one, 'ai');

    expect(one).toEqual({ open: ['dev'], pinned: false });
    expect(two).toEqual({ open: ['dev', 'ai'], pinned: false });
    expect(toggle(two, 'dev')).toEqual({ open: ['ai'], pinned: false });
  });

  it('does not mutate the previous state', () => {
    const state: MenuState = { open: ['dev'], pinned: false };
    toggle(state, 'ai');
    expect(state.open).toEqual(['dev']);
  });
});
