/**
 * GATE_DIRECTIONS (SAVP Zone scope) — chiều đi qua cổng của một lượt ra/vào.
 *
 * Thống nhất từ vựng với 3 nơi đã có trong hệ: `iot_device_events.direction`,
 * `ListVehicleHistoryQueryDto` (anpr UC7) dùng `enter`/`leave`, và IVSS
 * `channel_direction_map` ({"0":"enter","1":"leave"}). KHÔNG dùng `in`/`out`.
 *
 * ⚠ RÀNG BUỘC cho writer UC-105: PHẢI ghi đúng `'enter'`/`'leave'` vào
 * `gate_access_logs.direction`. Cột là varchar(10) KHÔNG có CHECK ⇒ DB không ép;
 * ràng buộc chỉ tồn tại ở tầng application (hằng này + @IsIn ở DTO).
 *
 * Bỏ `'seen'` (chỉ camera hành lang mới có trạng thái "thấy"; cổng chỉ vào/ra).
 */
export const GATE_DIRECTIONS = ['enter', 'leave'] as const;

export type GateDirection = (typeof GATE_DIRECTIONS)[number];
