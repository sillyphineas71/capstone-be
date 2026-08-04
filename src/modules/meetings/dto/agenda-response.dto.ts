import { AgendaAttachmentDto } from './agenda-attachment.dto.js';

export class AgendaItemResponseDto {
  id: string;
  agendaOrder: number;
  title: string;
  description: string | null;
  ownerId: string | null;
  ownerName: string | null;
  plannedDurationMinutes: number;
  status: string;
  attachments?: AgendaAttachmentDto[];

  constructor(data: Partial<AgendaItemResponseDto>) {
    Object.assign(this, data);
  }
}

export class AgendaListResponseDto {
  meetingId: string;
  meetingStatus: string;
  meetingDurationMinutes: number;
  totalPlannedDurationMinutes: number;
  remainingDurationMinutes: number;
  durationStatus: 'valid' | 'overflow';
  isLockedForEditing: boolean;
  lockReason: string | null;
  items: AgendaItemResponseDto[];

  constructor(data: Partial<AgendaListResponseDto>) {
    Object.assign(this, data);
  }
}

export class ReplaceAgendaResponseDto {
  meetingId: string;
  totalPlannedDurationMinutes: number;
  remainingDurationMinutes: number;
  items: AgendaItemResponseDto[];

  constructor(data: Partial<ReplaceAgendaResponseDto>) {
    Object.assign(this, data);
  }
}

export class AgendaItemUpdateResponseDto {
  id: string;
  meetingId: string;
  agendaOrder: number;
  title: string;
  description: string | null;
  ownerId: string | null;
  ownerName: string | null;
  plannedDurationMinutes: number;
  status: string;
  updatedAt: Date;
  totalPlannedDurationMinutes: number;
  remainingDurationMinutes: number;

  constructor(data: Partial<AgendaItemUpdateResponseDto>) {
    Object.assign(this, data);
  }
}

export class DeleteAgendaItemResponseDto {
  deleted: boolean;
  agendaId: string;
  meetingId: string;
  totalPlannedDurationMinutes: number;
  remainingDurationMinutes: number;
  remainingItemCount: number;

  constructor(data: Partial<DeleteAgendaItemResponseDto>) {
    Object.assign(this, data);
  }
}
