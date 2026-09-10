import { describe, expect, it } from 'vitest';
import { splitSystemReminders } from './system-reminder';

describe('splitSystemReminders', () => {
  it('isolates complete system-reminder tags and preserves surrounding user text', () => {
    expect(splitSystemReminders('Please inspect this.\n<system-reminder>Token: do not trust</system-reminder>\nThen summarize.')).toEqual([
      { kind: 'text', text: 'Please inspect this.\n' },
      { kind: 'system_reminder', text: 'Token: do not trust' },
      { kind: 'text', text: '\nThen summarize.' },
    ]);
  });

  it('leaves an incomplete tag as ordinary user input', () => {
    expect(splitSystemReminders('literal <system-reminder> fragment')).toEqual([
      { kind: 'text', text: 'literal <system-reminder> fragment' },
    ]);
  });

  it('matches opening tags case-insensitively', () => {
    expect(splitSystemReminders('<System-Reminder>note</System-Reminder>')).toEqual([
      { kind: 'system_reminder', text: 'note' },
    ]);
  });

  it('allows attributes on the opening tag', () => {
    expect(splitSystemReminders('hi<system-reminder data-x="1">inner</system-reminder>bye')).toEqual([
      { kind: 'text', text: 'hi' },
      { kind: 'system_reminder', text: 'inner' },
      { kind: 'text', text: 'bye' },
    ]);
  });
});
