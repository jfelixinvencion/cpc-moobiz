/** Tipos para bolsas de empresas críticas (subpestaña Clientes). */

export type ClientBucketLevel = 1 | 2 | 3;

export type ClientBucketRow = {
  co_id: string;
  co_name: string;
  bucket_level: ClientBucketLevel;
  created_by: string;
  created_at: string;
};

export type ClientBucketCompanyOption = {
  co_id: string;
  co_name: string;
};

export type ClientBucketsListResponse = {
  data: ClientBucketRow[];
};

export type ClientBucketUpsertBody = {
  co_id: number | string;
  co_name?: string;
  bucket_level: number;
};

export type ClientBucketBulkBody = {
  co_ids: Array<number | string>;
  bucket_level: number;
  co_names?: Record<string, string>;
};
