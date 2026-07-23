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
  useExcelFiles,
  useExcelWorkbook,
  useSyncSpreadsheet,
  type CsvMapping,
  type ImportResult,
} from "@/hooks/useImport";

type Field = keyof CsvMapping;
const FIELDS: { key: Field; label: string; required: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description", required: true },
  { key: "amount", label: "Amount", required: true },
  { key: "category", label: "Category", required: false },
];

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

  function onSync() {
    if (!ready) return;
    sync.mutate(
      {
        file: file!,
        worksheet: worksheet!,
        mapping: mapping as CsvMapping,
        ...(negate ? { negateAmounts: true } : {}),
      },
      { onSuccess: setResult }
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: COLORS.brandPurple, fontSize: 24, marginRight: 4 }}>‹</Text>
          <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: "800" }}>Excel / OneDrive</Text>
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
              {result.unparseableRows?.length
                ? `\n${result.unparseableRows.length} row${result.unparseableRows.length === 1 ? "" : "s"} couldn't be read`
                : ""}
            </Text>
            {(result.unparseableRows as string[] | undefined)?.slice(0, 5).map((e, i) => (
              <Text key={i} style={{ color: COLORS.warning, fontSize: 12, marginTop: 4 }} numberOfLines={2}>
                {String(e)}
              </Text>
            ))}
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
