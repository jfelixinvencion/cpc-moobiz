import type { ClientBucketCompanyOption } from "./client-buckets-types";

/** Mínimo de caracteres para lanzar búsqueda en el modal de bolsas. */
export const CLIENT_BUCKETS_SEARCH_MIN_CHARS = 2;

export const CLIENT_BUCKETS_SEARCH_DEBOUNCE_MS = 300;

export type CompanySearchUiState = {
  options: ClientBucketCompanyOption[];
  isSearching: boolean;
  hasSearched: boolean;
  error: string | null;
};

export function initialCompanySearchUiState(): CompanySearchUiState {
  return {
    options: [],
    isSearching: false,
    hasSearched: false,
    error: null,
  };
}

/** Aplica respuesta solo si `requestId` sigue siendo el último solicitado. */
export function applyCompanySearchSuccess(
  prev: CompanySearchUiState,
  requestId: number,
  latestRequestId: number,
  options: ClientBucketCompanyOption[],
): CompanySearchUiState {
  if (requestId !== latestRequestId) return prev;
  return {
    options,
    isSearching: false,
    hasSearched: true,
    error: null,
  };
}

export function applyCompanySearchError(
  prev: CompanySearchUiState,
  requestId: number,
  latestRequestId: number,
  message: string,
): CompanySearchUiState {
  if (requestId !== latestRequestId) return prev;
  return {
    ...prev,
    isSearching: false,
    hasSearched: true,
    error: message,
  };
}

export function shouldRunCompanySearch(debouncedQuery: string): boolean {
  return debouncedQuery.trim().length >= CLIENT_BUCKETS_SEARCH_MIN_CHARS;
}

export function pickCompanyOnEnter(
  options: ClientBucketCompanyOption[],
  query: string,
): ClientBucketCompanyOption | null {
  const q = query.trim().toLowerCase();
  if (options.length === 0) return null;
  const exact = options.find(
    (o) =>
      o.co_name.toLowerCase() === q || o.co_id.toLowerCase() === q,
  );
  return exact ?? options[0] ?? null;
}
