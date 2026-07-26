# API Contract: Vehicle Alert

## Endpoint: List Unknown Vehicles
**GET** /api/v1/anpr/unknown-vehicles

Query params: page, limit, from, to, sortBy, sortOrder

Response 200: Paginated list
Error 401, 403 (vehicle_alert.read), 422

## Internal: evaluate()
Params: plateNumber, context, eventId
Returns: void (NotThrow)
