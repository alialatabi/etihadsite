import { describe, expect, it } from 'vitest';
import robots from '@/app/robots';
import { isStaffPath, isTeamPath } from '@/lib/analytics/paths';

describe('/team stays out of analytics', () => {
  it.each(['/team', '/team/login', '/Team', '/TEAM/Login'])('%s is a team path and a staff path', (p) => {
    expect(isTeamPath(p)).toBe(true);
    expect(isStaffPath(p)).toBe(true);
  });

  it.each(['/teams', '/teamwork', '/', '/how-it-works', '/team-up'])('%s is neither', (p) => {
    expect(isTeamPath(p)).toBe(false);
    expect(isStaffPath(p)).toBe(false);
  });

  it('the secret sheet page paths still count as staff paths', () => {
    expect(isStaffPath('/staff/abc')).toBe(true);
    expect(isStaffPath('/staff-sheets')).toBe(true);
    expect(isStaffPath('/staffing')).toBe(false);
  });
});

describe('/team stays out of robots', () => {
  it('robots disallows /team', () => {
    const rules = robots().rules as { disallow?: string | string[] };
    expect(rules.disallow).toContain('/team');
    expect(rules.disallow).toEqual(expect.arrayContaining(['/admin', '/api']));
  });
});
