import type { SearchType } from '../constants/search-type.constant.js';

export interface SearchResultItemDto {
  type: SearchType;
  id: string;
  label: string;
  subtitle: string | null;
}

export interface SearchTypeResultDto {
  type: SearchType;
  items: SearchResultItemDto[];
}

export interface SearchResponseDto {
  query: string;
  /** Chỉ chứa type mà user có permission đọc — type không có quyền bị loại hẳn (spec R4). */
  types: SearchTypeResultDto[];
}
