export type EquipmentFaultEventType = 'reported' | 'confirmed' | 'resolved';

/**
 * Item trong lich su bao hong / xac nhan / khac phuc cua 1 thiet bi
 * (GET /equipments/:id/fault-history). Duoc suy ra tu audit_logs — khong co
 * bang rieng, xem EquipmentService.getFaultHistory().
 */
export class EquipmentFaultHistoryItemDto {
  id: string;
  eventType: EquipmentFaultEventType;
  actorId: string | null;
  actorName: string | null;
  note: string | null;
  healthStatus: string | null;
  assetStatus: string | null;
  createdAt: Date;

  constructor(data: EquipmentFaultHistoryItemDto) {
    Object.assign(this, data);
  }
}
