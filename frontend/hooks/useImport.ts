import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import * as WebBrowser from "expo-web-browser";
import { api } from "@/lib/api";

export interface CsvMapping {
  date: string;
  description: string;
  amount: string;
  category?: string;
}

/** Matches the import routes' actual response — verified against /api/import/csv. */
export interface ImportResult {
  ok: boolean;
  imported: number;
  duplicates: number;
  accountId?: string;
  unparseableRows?: unknown[];
}

/** One of the file's categories that resolves to an existing category. */
export interface MatchedCategory {
  source: string;
  envelope: string;
  rows: number;
}

/** One that doesn't — its rows would count toward no budget. */
export interface UnmatchedCategory {
  source: string;
  rows: number;
  suggestion?: string;
}

/** Response of /api/import/csv/preview — the item-7 pre-commit check. */
export interface ImportPreview {
  ok: boolean;
  rows: number;
  unparseableRows: number;
  matched: MatchedCategory[];
  unmatched: UnmatchedCategory[];
  envelopeNames: string[];
}

/** Imported rows land in transactions, so budget/bank views must refetch. */
function useImportMutation<TArgs>(fn: (args: TArgs) => Promise<ImportResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget"] });
      qc.invalidateQueries({ queryKey: ["banks"] });
      qc.invalidateQueries({ queryKey: ["system-status"] });
    },
  });
}

/**
 * Reads a picked file as text. The picker hands back a blob: URL on web and a
 * file:// URI on native, which need different readers.
 */
export async function readFileText(uri: string): Promise<string> {
  if (Platform.OS === "web") {
    const res = await fetch(uri);
    return res.text();
  }
  return FileSystem.readAsStringAsync(uri);
}

/**
 * Header row of a CSV, for the column-mapping step. Deliberately minimal — the
 * backend owns real parsing; this only needs enough to list column names.
 */
export function parseCsvHeaders(csv: string): string[] {
  const firstLine = csv.split(/\r?\n/).find((l) => l.trim().length > 0);
  if (!firstLine) return [];
  return firstLine
    .split(",")
    .map((h) => h.trim().replace(/^"|"$/g, ""))
    .filter((h) => h.length > 0);
}

export { amountSignProfile, type AmountSignProfile } from "@/lib/csv-signs";

/** POSTs the file contents as JSON — the route takes {csv, mapping}, not multipart. */
export function useImportCsv() {
  return useImportMutation(
    (body: {
      csv: string;
      mapping: CsvMapping;
      negateAmounts?: boolean;
      categoryMappings?: Record<string, string>;
    }) => api.post<ImportResult>("/api/import/csv", body)
  );
}

/**
 * Dry-run before the commit: which of the file's categories match no existing
 * category (with row counts + suggestions). No writes, so a plain mutation
 * with no cache invalidation.
 */
export function useImportPreviewCsv() {
  return useMutation({
    mutationFn: (body: { csv: string; mapping: CsvMapping; negateAmounts?: boolean }) =>
      api.post<ImportPreview>("/api/import/csv/preview", body),
  });
}

/**
 * Live spreadsheet connections. Both vendors share a shape: ask the backend for
 * a consent URL, hand off to the browser, then sync.
 */
function useSpreadsheetConnect(provider: "google" | "excel") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { url } = await api.get<{ url: string }>(`/api/import/${provider}/start`);
      const result = await WebBrowser.openAuthSessionAsync(
        url,
        `finance-dashboard://${provider}-import-complete`
      );
      return result.type;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["import-connections"] }),
  });
}

export const useConnectGoogleSheets = () => useSpreadsheetConnect("google");
export const useConnectExcel = () => useSpreadsheetConnect("excel");

export function useSyncSpreadsheet(provider: "google" | "excel") {
  return useImportMutation((body: { file: string; worksheet: string; mapping?: CsvMapping }) =>
    api.post<ImportResult>(`/api/import/${provider}/sync`, body)
  );
}
