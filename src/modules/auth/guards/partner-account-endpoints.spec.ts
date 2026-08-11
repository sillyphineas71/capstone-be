import 'reflect-metadata';
import { ALLOW_PARTNER_ACCOUNT_KEY } from '../../../common/decorators/allow-partner-account.decorator.js';
import { AuthController } from '../../auth/controllers/auth.controller.js';
import { MeetingsController } from '../../meetings/controllers/meetings.controller.js';
import { LiveMeetingController } from '../../live-meeting/controllers/live-meeting.controller.js';

describe('PTA decorated endpoints', () => {
  it('marks auth basics as partner-accessible', () => {
    expect(Reflect.getMetadata(ALLOW_PARTNER_ACCOUNT_KEY, AuthController.prototype.getMe)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_PARTNER_ACCOUNT_KEY, AuthController.prototype.logout)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_PARTNER_ACCOUNT_KEY, AuthController.prototype.changePassword)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_PARTNER_ACCOUNT_KEY, AuthController.prototype.refresh)).toBe(true);
  });

  it('marks meeting read endpoints that filter by meeting participant', () => {
    expect(Reflect.getMetadata(ALLOW_PARTNER_ACCOUNT_KEY, MeetingsController.prototype.getMeetingById)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_PARTNER_ACCOUNT_KEY, MeetingsController.prototype.getAgendas)).toBe(true);
  });

  it('marks live meeting read endpoints that filter by meeting participant', () => {
    expect(Reflect.getMetadata(ALLOW_PARTNER_ACCOUNT_KEY, LiveMeetingController.prototype.listNotes)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_PARTNER_ACCOUNT_KEY, LiveMeetingController.prototype.getMeetingTimeline)).toBe(true);
  });
});