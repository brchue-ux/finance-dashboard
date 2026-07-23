/**
 * OneDrive Excel live import — the in-app flow the CSV path can't cover: a
 * workbook that keeps living in OneDrive syncs on demand with no re-export.
 *
 * Flow: connect (if needed) → pick workbook → pick worksheet → map columns
 * (auto-prefilled on exact header matches) → sync → result. Mirrors the CSV
 * screen's mapping idiom so the two imports read as one feature.
 *
 * Known dev-environment limit, deliberate: the OAuth redirect URI is
 * localhost:3011, so completing CONNECT from the phone needs the deployed
 * backend's https redirect. Everything after connect (browse/map/sync) talks
 * only to our own API and works on device today.
 */
import { useMemo, useState } from "react";
import { ScrollView, View, Text, Pressable, ActivityIndicator, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS } from "@/constants/theme";
import {
  useConnectExcel,
  useExcelAutoSync,
  useExcelFiles,
  useExcelWorkbook,
  useSyncSpreadsheet,
  type CsvMapping,
  type ImportResult,
  type MatchedCategory,
  type UnmatchedCategory,
} from "@/hooks/useImport";

/** The item-7 pause: the sheet's category column had names that match no
 *  envelope; the user maps or keeps each before anything is written. */
interface CategoryReview {
  matched: MatchedCategory[];
  unmatched: UnmatchedCategory[];
  envelopeNames: string[];
}

type Field = keyof CsvMapping;
const FIELDS: { key: Field; label: string; required: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description", required: true },
  { key: "amount", label: "Amount", required: true },
  { key: "category", label: "Category", required: false },
];

/**
 * The server's per-row error strings are debug-shaped (`row 9 ("X"): unparseable
 * date "…" or amount "…"`) — accurate, but they read as code on a success
 * screen. Reduce to the two facts a person acts on: which row, which merchant.
 */
function friendlyRowError(raw: string): string {
  const m = raw.match(/^row (\d+)(?: \("(.+)"\))?:/);
  if (!m) return raw;
  return `Row ${m[1]}${m[2] ? ` — ${m[2]}` : ""} couldn’t be read (check its date and amount)`;
}

/** Prefill a field when a header IS that field's name (case-insensitive). */
function autoMap(headers: string[]): Partial<CsvMapping> {
  const out: Partial<CsvMapping> = {};
  for (const f of FIELDS) {
    const hit = headers.find((h) => h.trim().toLowerCase() === f.key);
    if (hit) out[f.key] = hit;
  }
  return out;
}

export default function ImportExcelScreen() {
  const router = useRouter();
  const connect = useConnectExcel();
  const files = useExcelFiles();
  const sync = useSyncSpreadsheet("excel");

  const [file, setFile] = useState<string | null>(null);
  const [worksheet, setWorksheet] = useState<string | null>(null);
  const workbook = useExcelWorkbook(file, worksheet);
  const [mapping, setMapping] = useState<Partial<CsvMapping>>({});
  const [activeField, setActiveField] = useState<Field | null>(null);
  const [negate, setNegate] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [review, setReview] = useState<CategoryReview | null>(null);
  const [catMap, setCatMap] = useState<Record<string, string | null>>({});
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const autoSync = useExcelAutoSync();

  const headers = workbook.data?.headers ?? [];
  const worksheets = workbook.data?.worksheets ?? [];
  const ready = Boolean(file && worksheet && mapping.date && mapping.description && mapping.amount);

  // Auto-select a single worksheet and prefill obvious header matches — the
  // common case (one tab, sane headers) should be pick-file-then-sync.
  useMemo(() => {
    if (worksheets.length === 1 && worksheet === null) setWorksheet(worksheets[0]);
  }, [worksheets, worksheet]);
  useMemo(() => {
    if (headers.length > 0 && Object.keys(mapping).length === 0) setMapping(autoMap(headers));
  }, [headers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Which config the current sync/review round uses: the pickers' explicit one,
  // or `{useSaved:true}` replaying the persisted config ("Sync now"). Stored in
  // state ONLY so the review step's later commit remembers the round's mode —
  // within a round the mode is passed explicitly, never read back same-tick.
  const [savedMode, setSavedMode] = useState(false);
  const configFor = (saved: boolean) =>
    saved
      ? ({ useSaved: true } as const)
      : {
          file: file!,
          worksheet: worksheet!,
          mapping: mapping as CsvMapping,
          ...(negate ? { negateAmounts: true } : {}),
        };

  function commit(saved: boolean, categoryMappings?: Record<string, string>) {
    sync.mutate(
      { ...configFor(saved), ...(categoryMappings ? { categoryMappings } : {}) },
      {
        onSuccess: (r) => {
          setResult(r);
          setReview(null);
        },
      }
    );
  }

  // The item-7 pause, on BOTH paths (explicit and saved — a living sheet can
  // grow new category names between syncs): preview first; unmatched names
  // stop on a review step instead of silently landing outside every envelope.
  function previewThenCommit(saved: boolean) {
    setSavedMode(saved);
    sync.mutate(
      { ...configFor(saved), previewOnly: true },
      {
        onSuccess: (r) => {
          if (r.unmatched && r.unmatched.length > 0) {
            setReview({ matched: r.matched ?? [], unmatched: r.unmatched, envelopeNames: r.envelopeNames ?? [] });
            // Suggestions pre-fill; the user confirms by importing.
            setCatMap(Object.fromEntries(r.unmatched.map((u) => [u.source, u.suggestion ?? null])));
          } else {
            commit(saved);
          }
        },
      }
    );
  }

  function onSync() {
    if (!ready) return;
    if (mapping.category) previewThenCommit(false);
    else commit(false);
  }

  function onCommitReviewed() {
    const mappings: Record<string, string> = {};
    for (const [source, target] of Object.entries(catMap)) if (target) mappings[source] = target;
    commit(savedMode, Object.keys(mappings).length > 0 ? mappings : undefined);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: COLORS.brandPurple, fontSize: 24, marginRight: 4 }}>‹</Text>
          <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: "800" }}>Microsoft Excel</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {result ? (
          <View style={{ alignItems: "center", paddingVertical: 24 }}>
            <Text style={{ fontSize: 40 }}>✓</Text>
            <Text style={{ color: COLORS.textPrimary, fontSize: 17, fontWeight: "700", marginTop: 8 }}>
              Sync complete
            </Text>
            <Text style={{ color: COLORS.textMuted, fontSize: 14, marginTop: 8, textAlign: "center" }}>
              {result.imported} imported · {result.duplicates} already present
            </Text>
            {result.unparseableRows?.length ? (
              <View style={{ marginTop: 12, alignSelf: "stretch", backgroundColor: COLORS.glassBg, borderWidth: 1, borderColor: COLORS.glassBorder, borderRadius: 10, padding: 12 }}>
                <Text style={{ color: COLORS.warning, fontSize: 12, fontWeight: "700", marginBottom: 6 }}>
                  {result.unparseableRows.length} ROW{result.unparseableRows.length === 1 ? "" : "S"} SKIPPED
                </Text>
                {(result.unparseableRows as string[]).slice(0, 5).map((e, i) => (
                  <Text key={i} style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }} numberOfLines={2}>
                    {friendlyRowError(String(e))}
                  </Text>
                ))}
              </View>
            ) : null}
            <Pressable
              onPress={() => router.push("/transactions" as never)}
              style={{ backgroundColor: COLORS.brandPurple, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12, marginTop: 20 }}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>View transactions</Text>
            </Pressable>
            <Pressable onPress={() => setResult(null)} style={{ marginTop: 14 }}>
              <Text style={{ color: COLORS.textMuted, fontSize: 13 }}>Sync again</Text>
            </Pressable>
          </View>
        ) : review ? (
          <View>
            <Text style={{ color: COLORS.textPrimary, fontSize: 16, fontWeight: "700" }}>
              Some categories don’t match your envelopes
            </Text>
            <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 6, lineHeight: 19 }}>
              {review.matched.length > 0
                ? `${review.matched.length} matched on their own. `
                : ""}
              Map the rest to an envelope, or keep them as-is (their rows won’t count toward any budget).
            </Text>
            {review.unmatched.map((u) => (
              <View key={u.source} style={{ marginTop: 12 }}>
                <Pressable
                  onPress={() => setActiveSource(activeSource === u.source ? null : u.source)}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: COLORS.glassBorder,
                    backgroundColor: COLORS.glassBg,
                  }}
                >
                  <Text style={{ color: COLORS.textPrimary, fontSize: 14, flex: 1 }} numberOfLines={1}>
                    {u.source} <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>({u.rows} rows)</Text>
                  </Text>
                  <Text style={{ color: catMap[u.source] ? COLORS.brandPurple : COLORS.textMuted, fontSize: 13 }}>
                    {catMap[u.source] ?? "keep as-is"}
                  </Text>
                </Pressable>
                {activeSource === u.source && (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6, marginLeft: 8 }}>
                    <Pressable
                      onPress={() => {
                        setCatMap((m) => ({ ...m, [u.source]: null }));
                        setActiveSource(null);
                      }}
                      style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: COLORS.glassBorder }}
                    >
                      <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>Keep as-is</Text>
                    </Pressable>
                    {review.envelopeNames.map((name) => (
                      <Pressable
                        key={name}
                        onPress={() => {
                          setCatMap((m) => ({ ...m, [u.source]: name }));
                          setActiveSource(null);
                        }}
                        style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: COLORS.glassBorder }}
                      >
                        <Text style={{ color: COLORS.textPrimary, fontSize: 12 }}>{name}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            ))}
            <Pressable
              onPress={onCommitReviewed}
              disabled={sync.isPending}
              style={{ backgroundColor: COLORS.brandPurple, borderRadius: 10, paddingVertical: 13, alignItems: "center", marginTop: 18 }}
            >
              {sync.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "700" }}>Import transactions</Text>
              )}
            </Pressable>
            <Pressable onPress={() => setReview(null)} style={{ marginTop: 12, alignItems: "center" }}>
              <Text style={{ color: COLORS.textMuted, fontSize: 13 }}>‹ Back</Text>
            </Pressable>
          </View>
        ) : files.isLoading ? (
          <ActivityIndicator color={COLORS.brandPurple} style={{ marginTop: 32 }} />
        ) : !files.data?.connected ? (
          <View>
            <Text style={{ color: COLORS.textMuted, fontSize: 13, lineHeight: 19 }}>
              Connect a personal Microsoft account and your OneDrive workbooks sync on demand —
              no re-export each time. Work or school accounts without OneDrive can’t expose files.
            </Text>
            <Pressable
              onPress={() => connect.mutate(undefined)}
              disabled={connect.isPending || !files.data?.configured}
              style={{ backgroundColor: COLORS.brandPurple, borderRadius: 10, paddingVertical: 13, alignItems: "center", marginTop: 16 }}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>
                {connect.isPending ? "Opening…" : "Connect Microsoft account"}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View>
            {/* Saved sync: replay the last configuration with one tap, and the
                nightly opt-in. Only shown once a sync has persisted a config. */}
            {files.data.saved && (
              <View style={{ backgroundColor: COLORS.glassBg, borderWidth: 1, borderColor: COLORS.glassBorder, borderRadius: 12, padding: 14, marginBottom: 18 }}>
                <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 1 }}>
                  SAVED SYNC
                </Text>
                <Text style={{ color: COLORS.textPrimary, fontSize: 14, marginTop: 6 }} numberOfLines={1}>
                  {files.data.saved.file} · {files.data.saved.worksheet}
                </Text>
                {files.data.lastSyncedAt ? (
                  <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>
                    Last synced {new Date(files.data.lastSyncedAt * 1000).toLocaleString()}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => previewThenCommit(true)}
                  disabled={sync.isPending}
                  style={{ backgroundColor: COLORS.brandPurple, borderRadius: 10, paddingVertical: 11, alignItems: "center", marginTop: 12 }}
                >
                  {sync.isPending ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>Sync now</Text>
                  )}
                </Pressable>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
                  <Text style={{ color: COLORS.textMuted, fontSize: 13, flex: 1 }}>
                    Also sync every night
                  </Text>
                  <Switch
                    value={files.data.autoSync ?? false}
                    onValueChange={(v) => autoSync.mutate(v)}
                    disabled={autoSync.isPending}
                  />
                </View>
              </View>
            )}

            {/* Workbook */}
            <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 1, marginBottom: 8 }}>
              WORKBOOK
            </Text>
            {files.data.files.length === 0 && (
              <Text style={{ color: COLORS.textMuted, fontSize: 13 }}>
                No .xlsx files in this OneDrive yet.
              </Text>
            )}
            {files.data.files.map((f) => {
              const active = file === f.path;
              return (
                <Pressable
                  key={f.path}
                  onPress={() => {
                    setFile(f.path);
                    setWorksheet(null);
                    setMapping({});
                    setActiveField(null);
                  }}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: active ? COLORS.brandPurple : COLORS.glassBorder,
                    backgroundColor: active ? "rgba(124,58,237,0.15)" : COLORS.glassBg,
                    marginBottom: 6,
                  }}
                >
                  <Text style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: active ? "700" : "400" }}>
                    {f.name}
                  </Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: 11, marginTop: 2 }}>{f.path}</Text>
                </Pressable>
              );
            })}

            {/* Worksheet */}
            {file && (
              <>
                <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 1, marginTop: 16, marginBottom: 8 }}>
                  WORKSHEET
                </Text>
                {workbook.isLoading ? (
                  <ActivityIndicator color={COLORS.textMuted} />
                ) : (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {worksheets.map((w) => (
                      <Pressable
                        key={w}
                        onPress={() => {
                          setWorksheet(w);
                          setMapping({});
                        }}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: worksheet === w ? COLORS.brandPurple : COLORS.glassBorder,
                          backgroundColor: worksheet === w ? "rgba(124,58,237,0.15)" : "transparent",
                        }}
                      >
                        <Text style={{ color: worksheet === w ? COLORS.textPrimary : COLORS.textMuted, fontSize: 13, fontWeight: "600" }}>
                          {w}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </>
            )}

            {/* Mapping */}
            {worksheet && headers.length > 0 && (
              <>
                <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 1, marginTop: 16, marginBottom: 8 }}>
                  MATCH YOUR COLUMNS
                </Text>
                {FIELDS.map((f) => (
                  <View key={f.key} style={{ marginBottom: 8 }}>
                    <Pressable
                      onPress={() => setActiveField(activeField === f.key ? null : f.key)}
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        paddingVertical: 8,
                        paddingHorizontal: 10,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: f.required && !mapping[f.key] ? COLORS.warning : COLORS.glassBorder,
                      }}
                    >
                      <Text style={{ color: COLORS.textPrimary, fontSize: 13 }}>
                        {f.label}
                        {f.required ? "" : " (optional)"}
                      </Text>
                      <Text style={{ color: mapping[f.key] ? COLORS.brandPurple : COLORS.textMuted, fontSize: 12 }}>
                        {mapping[f.key] ?? "tap to choose"}
                      </Text>
                    </Pressable>
                    {activeField === f.key && (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6, marginLeft: 8 }}>
                        {!f.required && (
                          <Pressable
                            onPress={() => {
                              setMapping((m) => ({ ...m, [f.key]: undefined }));
                              setActiveField(null);
                            }}
                            style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: COLORS.glassBorder }}
                          >
                            <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>None</Text>
                          </Pressable>
                        )}
                        {headers.map((h) => (
                          <Pressable
                            key={h}
                            onPress={() => {
                              setMapping((m) => ({ ...m, [f.key]: h }));
                              setActiveField(null);
                            }}
                            style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: COLORS.glassBorder }}
                          >
                            <Text style={{ color: COLORS.textPrimary, fontSize: 12 }}>{h}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                ))}

                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                  <Text style={{ color: COLORS.textMuted, fontSize: 13, flex: 1 }}>
                    Positive amounts are spending
                  </Text>
                  <Switch value={negate} onValueChange={setNegate} />
                </View>

                <Pressable
                  onPress={onSync}
                  disabled={!ready || sync.isPending}
                  style={{
                    backgroundColor: ready ? COLORS.brandPurple : COLORS.glassBg,
                    borderRadius: 10,
                    paddingVertical: 13,
                    alignItems: "center",
                    marginTop: 16,
                  }}
                >
                  {sync.isPending ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={{ color: ready ? "#fff" : COLORS.textMuted, fontWeight: "700" }}>
                      Sync transactions
                    </Text>
                  )}
                </Pressable>
                {sync.isError && (
                  <Text style={{ color: COLORS.danger, fontSize: 12, marginTop: 8 }}>
                    {String(sync.error)}
                  </Text>
                )}
              </>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
