import { Test, TestingModule } from '@nestjs/testing';
import { GuestManagementController } from './guest-management.controller';
import { GuestManagementService } from '../services/guest-management.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';

describe('GuestManagementController', () => {
  let controller: GuestManagementController;
  let service: {
    listGuests: jest.Mock;
    listLobby: jest.Mock;
    admit: jest.Mock;
    reject: jest.Mock;
    resendInvite: jest.Mock;
    revokeAccess: jest.Mock;
  };

  const user = { userId: 'host-1' };

  beforeEach(async () => {
    service = {
      listGuests: jest.fn().mockResolvedValue([]),
      listLobby: jest.fn().mockResolvedValue([]),
      admit: jest.fn(),
      reject: jest.fn(),
      resendInvite: jest.fn(),
      revokeAccess: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GuestManagementController],
      providers: [{ provide: GuestManagementService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(GuestManagementController);
  });

  it('listGuests should delegate with meetingId + userId and return {success,message,data}', async () => {
    const result = await controller.listGuests('meeting-1', user);
    expect(service.listGuests).toHaveBeenCalledWith('meeting-1', 'host-1');
    expect(result.success).toBe(true);
  });

  it('listLobby should delegate correctly', async () => {
    await controller.listLobby('meeting-1', user);
    expect(service.listLobby).toHaveBeenCalledWith('meeting-1', 'host-1');
  });

  it('admit should delegate with meetingId, externalParticipantId, userId', async () => {
    await controller.admit('meeting-1', 'ep-1', user);
    expect(service.admit).toHaveBeenCalledWith('meeting-1', 'ep-1', 'host-1');
  });

  it('reject should delegate correctly', async () => {
    await controller.reject('meeting-1', 'ep-1', user);
    expect(service.reject).toHaveBeenCalledWith('meeting-1', 'ep-1', 'host-1');
  });

  it('resendInvite should delegate correctly', async () => {
    await controller.resendInvite('meeting-1', 'ep-1', user);
    expect(service.resendInvite).toHaveBeenCalledWith(
      'meeting-1',
      'ep-1',
      'host-1',
    );
  });

  it('revokeAccess should delegate correctly', async () => {
    await controller.revokeAccess('meeting-1', 'ep-1', user);
    expect(service.revokeAccess).toHaveBeenCalledWith(
      'meeting-1',
      'ep-1',
      'host-1',
    );
  });
});
