# Quickstart: Tìm kiếm ghi chú trong cuộc họp (Search Meeting Notes)

**Feature**: UC-IMM-11 / UC-104
**Date**: 2026-06-18

## Test Scenarios

### Happy Paths

1. **Host search keyword**: `GET /meetings/{id}/notes?q=triển khai` → 200, tất cả notes chứa "triển khai" kể cả private của người khác
2. **Co-host search keyword**: `GET /meetings/{id}/notes?q=quyết định` → 200, tất cả notes chứa "quyết định" NGOẠI TRỪ private notes của người khác
3. **Participant search keyword**: `GET /meetings/{id}/notes?q=keyword` → 200, chỉ shared + own notes khớp keyword
4. **Search + authorId filter**: `?q=keyword&authorId=<uuid>` → 200, AND logic
5. **Search + time range**: `?q=keyword&createdFrom=...&createdTo=...` → 200, AND logic
6. **Search + noteType**: `?q=keyword&noteType=in_meeting` → 200, chỉ in_meeting notes
7. **Search + pinned**: `?q=keyword&pinned=true` → 200, chỉ pinned notes
8. **Empty keyword**: `?q=` → 200, trả toàn bộ (view mode)

### Edge Cases

9. **No results**: `?q=zzznotexist` → 200, `data=[]`, `total=0`, message "Không tìm thấy ghi chú nào..."
10. **Case insensitive**: `?q=TRIỂN KHAI` → trả notes chứa "triển khai"
11. **Vietnamese unaccent** (nếu DB support): `?q=trien khai` → trả notes chứa "triển khai"
12. **Keyword max length**: `?q=` + 256 ký tự → 400 `VALIDATION_ERROR`
13. **Wildcard literal**: `?q=%meeting_` → tìm literal "%meeting_", không phải pattern match
14. **Private notes blocked**: Participant search keyword khớp private note của người khác → không trả

### Authorization

15. **No auth**: → 401
16. **No permission**: → 403 `PERMISSION_DENIED`
17. **Not participant**: → 403 `NOT_A_MEETING_PARTICIPANT`
18. **Meeting not found**: → 404
19. **Meeting wrong status** (scheduled): → 422 `MEETING_STATUS_NOT_VIEWABLE`

### Validation

20. **authorId invalid UUID**: → 400 `VALIDATION_ERROR`
21. **createdFrom sai format**: → 400 `VALIDATION_ERROR`
22. **createdFrom > createdTo**: → 400 `INVALID_DATE_RANGE`
23. **limit > 100**: → 400 `VALIDATION_ERROR`

## Verification Checklist

- [ ] Search với keyword → chỉ trả notes từ meeting đó
- [ ] Host thấy tất cả notes kể cả private của người khác
- [ ] Co-host không thấy private notes của người khác
- [ ] Participant không thấy private notes của ai khác
- [ ] `?q=` rỗng → view mode (không search)
- [ ] Case-insensitive search hoạt động
- [ ] Kết hợp search + filter bằng AND
- [ ] ILIKE escape wildcard đúng
- [ ] q > 255 → validation error
- [ ] Pagination hoạt động với search
- [ ] Không có side effect (read-only)
