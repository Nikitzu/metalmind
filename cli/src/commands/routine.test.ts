import { describe, expect, it } from 'vitest';
import { renderEodPlist } from './routine.js';

describe('renderEodPlist', () => {
  const opts = {
    hour: 17,
    minute: 30,
    metalmindBin: '/opt/homebrew/bin/metalmind',
    logDir: '/Users/test/Library/Logs',
  };

  it('includes the atium + gold commands in a single shell invocation', () => {
    const out = renderEodPlist(opts);
    expect(out).toContain('atium new --date next-workday --from');
    expect(out).toContain('gold "daily:$TODAY"');
  });

  it('schedules Mon–Fri only', () => {
    const out = renderEodPlist(opts);
    for (const day of [1, 2, 3, 4, 5]) {
      expect(out).toContain(`<integer>${day}</integer>`);
    }
    expect(out).not.toContain('<integer>0</integer>');
    expect(out).not.toContain('<integer>6</integer>');
  });

  it('encodes hour and minute', () => {
    const out = renderEodPlist(opts);
    expect(out).toContain('<key>Hour</key><integer>17</integer>');
    expect(out).toContain('<key>Minute</key><integer>30</integer>');
  });

  it('uses the right label', () => {
    const out = renderEodPlist(opts);
    expect(out).toContain('<string>com.metalmind.routine.eod</string>');
  });
});
