/**
 * Settings → Import transactions. Three parallel paths per the locked decision:
 * CSV upload (zero OAuth, covers any Sheets/Excel export), plus live Google
 * Sheets and Excel connections for people using a spreadsheet as an ongoing
 * source of truth rather than doing a one-time dump.
 *
 * CSV is a two-step flow because column names vary per bank: pick the file,
 * then map its headers onto date/description/amount. The backend rejects a bad
 * mapping, but mapping in the UI means the user fixes it without a failed round
 * trip.
 */
import { useState, useMemo } from "react";
import { ScrollView, View, Text, Pressable, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { GlassCard } from "@/components/ui/GlassCard";
import { GradientText } from "@/components/ui/GradientText";
import { COLORS } from "@/constants/theme";
import {
  useImportCsv,
  useImportPreviewCsv,
  useConnectGoogleSheets,
  readFileText,
  parseCsvHeaders,
  amountSignProfile,
  type CsvMapping,
  type ImportPreview,
} from "@/hooks/useImport";

type Field = keyof CsvMapping;

const FIELDS: { key: Field; label: string; hint: string; required: boolean }[] = [
  { key: "date", label: "Date", hint: "e.g. Transaction Date", required: true },
  { key: "description", label: "Description", hint: "e.g. Merchant", required: true },
  { key: "amount", label: "Amount", hint: "e.g. Amount", required: true },
  { key: "category", label: "Category", hint: "optional", required: false },
];

/** Best-effort header guess so the common case needs no tapping. */
function guessMapping(headers: string[]): Partial<CsvMapping> {
  const find = (...needles: string[]) =>
    headers.find((h) => needles.some((n) => h.toLowerCase().includes(n)));
  return {
    date: find("date"),
    description: find("description", "merchant", "details", "narrative"),
    amount: find("amount", "value", "debit"),
    category: find("category", "type"),
  };
}

export default function ImportScreen() {
  const router = useRouter();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Partial<CsvMapping>>({});
  const [negate, setNegate] = useState(false);
  // null = not yet answered; only consulted when the file's signs are uniform.
  const [signChoice, setSignChoice] = useState<"spending" | "deposits" | null>(null);
  const [activeField, setActiveField] = useState<Field | null>(null);
  // Item 7: when the file's category column has entries matching no existing
  // category, the import pauses on a review step instead of committing.
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  // Per unmatched source category: an existing category name, or null = keep
  // the file's word as-is (imports verbatim, counts toward no budget).
  const [catMappings, setCatMappings] = useState<Record<string, string | null>>({});
  const [activeUnmatched, setActiveUnmatched] = useState<string | null>(null);
  // A finished import renders in-app (what landed, what was skipped, which
  // matches were applied) instead of a bare native alert.
  const [result, setResult] = useState<{
    imported: number;
    duplicates: number;
    unreadable: number;
    recap: { source: string; target: string; rows: number }[];
  } | null>(null);

  const importCsv = useImportCsv();
  const previewCsv = useImportPreviewCsv();
  const connectGoogle = useConnectGoogleSheets();

  async function pickFile() {
    const res = await DocumentPicker.getDocumentAsync({
      type: ["text/csv", "text/comma-separated-values", "application/csv", "text/plain"],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return;

    const asset = res.assets[0];
    try {
      const text = await readFileText(asset.uri);
      const hdrs = parseCsvHeaders(text);
      if (hdrs.length === 0) {
        Alert.alert("Couldn’t read that file", "No header row was found.");
        return;
      }
      setCsv(text);
      setFileName(asset.name);
      setHeaders(hdrs);
      setMapping(guessMapping(hdrs));
    } catch (e) {
      Alert.alert("Couldn’t read that file", String(e));
    }
  }

  function commitImport(categoryMappings?: Record<string, string>) {
    if (!csv || !mapping.date || !mapping.description || !mapping.amount) return;
    importCsv.mutate(
      {
        csv,
        mapping: mapping as CsvMapping,
        // When the file is uniform-sign the explicit answer decides; otherwise
        // the manual toggle still applies.
        negateAmounts: needsSignAnswer ? signChoice === "spending" : negate,
        ...(categoryMappings && Object.keys(categoryMappings).length > 0
          ? { categoryMappings }
          : {}),
      },
      {
        onSuccess: (r) => {
          // The matches the user confirmed on the review step, for the recap.
          const recap = (preview?.unmatched ?? []).flatMap((u) => {
            const target = catMappings[u.source];
            return target ? [{ source: u.source, target, rows: u.rows }] : [];
          });
          reset();
          setResult({
            imported: r.imported,
            duplicates: r.duplicates,
            unreadable: r.unparseableRows?.length ?? 0,
            recap,
          });
        },
        onError: (e) => Alert.alert("Import failed", String(e)),
      }
    );
  }

  function runImport() {
    if (!csv || !mapping.date || !mapping.description || !mapping.amount) return;
    // No category column mapped → nothing to check; commit straight through.
    if (!mapping.category) {
      commitImport();
      return;
    }
    previewCsv.mutate(
      {
        csv,
        mapping: mapping as CsvMapping,
        negateAmounts: needsSignAnswer ? signChoice === "spending" : negate,
      },
      {
        onSuccess: (p) => {
          // Every category in the file resolves — no warning to show, commit
          // without an extra tap.
          if (p.unmatched.length === 0) {
            commitImport();
            return;
          }
          setPreview(p);
          // Suggestions pre-fill the mapping; the user confirms by importing.
          setCatMappings(
            Object.fromEntries(p.unmatched.map((u) => [u.source, u.suggestion ?? null]))
          );
        },
        onError: (e) => Alert.alert("Couldn’t check the file", String(e)),
      }
    );
  }

  function commitWithMappings() {
    const confirmed: Record<string, string> = {};
    for (const [source, target] of Object.entries(catMappings)) {
      if (target !== null) confirmed[source] = target;
    }
    commitImport(confirmed);
  }

  function reset() {
    setCsv(null);
    setFileName(null);
    setHeaders([]);
    setMapping({});
    setActiveField(null);
    setPreview(null);
    setCatMappings({});
    setActiveUnmatched(null);
  }

  const signs = useMemo(
    () => (csv && mapping.amount ? amountSignProfile(csv, mapping.amount) : null),
    [csv, mapping.amount]
  );
  // An all-positive file can't be imported until the user says what it means.
  const needsSignAnswer = Boolean(signs?.uniform && signs.positive > 0);

  const ready =
    Boolean(mapping.date && mapping.description && mapping.amount) &&
    (!needsSignAnswer || signChoice !== null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: COLORS.brandPurple, fontSize: 24, marginRight: 4 }}>‹</Text>
          <GradientText style={{ fontSize: 20, fontWeight: "800" }}>Import</GradientText>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* CSV */}
        <GlassCard style={{ marginBottom: 12 }}>
          <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
            CSV or spreadsheet export
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 6, lineHeight: 18 }}>
            Works with any Google Sheets or Excel export. No account access
            needed. Re-importing is safe — rows already imported are skipped.
          </Text>

          {result ? (
            /* Success state — in-app, not a bare native alert. */
            <View style={{ marginTop: 16, alignItems: "center" }}>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: "rgba(34,197,94,0.12)",
                  borderWidth: 1,
                  borderColor: "rgba(34,197,94,0.35)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: COLORS.success, fontSize: 26, fontWeight: "700" }}>✓</Text>
              </View>
              <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 17, marginTop: 12 }}>
                {result.imported === 0
                  ? "Nothing new to import"
                  : `${result.imported} transaction${result.imported === 1 ? "" : "s"} imported`}
              </Text>
              {(result.duplicates > 0 || result.unreadable > 0) && (
                <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 4 }}>
                  {[
                    result.duplicates > 0 ? `${result.duplicates} already imported` : null,
                    result.unreadable > 0 ? `${result.unreadable} couldn’t be read` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              )}

              {result.recap.length > 0 && (
                <View style={{ alignSelf: "stretch", marginTop: 14 }}>
                  <Text
                    style={{
                      color: COLORS.textMuted,
                      fontSize: 11,
                      fontWeight: "600",
                      letterSpacing: 1,
                      marginBottom: 6,
                    }}
                  >
                    MATCHED FOR YOU
                  </Text>
                  {result.recap.map((m) => (
                    <View
                      key={m.source}
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        paddingVertical: 6,
                        borderBottomWidth: 1,
                        borderBottomColor: COLORS.glassBorder,
                      }}
                    >
                      <Text style={{ color: COLORS.textPrimary, fontSize: 13 }} numberOfLines={1}>
                        <Text style={{ color: COLORS.textMuted }}>{m.source}</Text>
                        {"  →  "}
                        {m.target}
                      </Text>
                      <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>
                        {m.rows} row{m.rows === 1 ? "" : "s"}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              <Pressable
                onPress={() => router.push("/transactions")}
                style={{
                  alignSelf: "stretch",
                  marginTop: 16,
                  paddingVertical: 11,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: COLORS.brandPurple,
                  backgroundColor: "rgba(124,58,237,0.12)",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: COLORS.brandPurple, fontWeight: "600", fontSize: 14 }}>
                  View transactions
                </Text>
              </Pressable>
              <Pressable onPress={() => setResult(null)} style={{ marginTop: 12, paddingVertical: 4 }}>
                <Text style={{ color: COLORS.textMuted, fontSize: 13 }}>Import another file</Text>
              </Pressable>
            </View>
          ) : !csv ? (
            <Pressable onPress={pickFile} style={{ marginTop: 12 }}>
              <Text style={{ color: COLORS.brandPurple, fontWeight: "600", fontSize: 14 }}>
                Choose a file
              </Text>
            </Pressable>
          ) : preview ? (
            /* Item 7 review step: the file has categories matching none of the
               user's — pause before committing, offer mappings. */
            <View style={{ marginTop: 12 }}>
              <Text style={{ color: COLORS.warning, fontSize: 13, fontWeight: "600" }}>
                {preview.unmatched.length} of {preview.matched.length + preview.unmatched.length}{" "}
                categories in this file don’t match any of your categories
              </Text>
              {(() => {
                const uncovered = preview.unmatched
                  .filter((u) => catMappings[u.source] == null)
                  .reduce((sum, u) => sum + u.rows, 0);
                return (
                  <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 4, lineHeight: 17 }}>
                    {uncovered > 0
                      ? `${uncovered} row${uncovered === 1 ? "" : "s"} won’t count toward any budget. Match them below, or keep the file’s wording.`
                      : "All matched — every row will count toward a budget."}
                  </Text>
                );
              })()}

              <View style={{ marginTop: 10 }}>
                {preview.unmatched.map((u) => {
                  const chosen = catMappings[u.source] ?? null;
                  const open = activeUnmatched === u.source;
                  return (
                    <View key={u.source} style={{ marginBottom: 8 }}>
                      <Pressable
                        onPress={() => setActiveUnmatched(open ? null : u.source)}
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                          paddingVertical: 8,
                          paddingHorizontal: 10,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: chosen ? COLORS.glassBorder : COLORS.warning,
                        }}
                      >
                        <Text style={{ color: COLORS.textPrimary, fontSize: 13, flex: 1 }} numberOfLines={1}>
                          {u.source}{" "}
                          <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>
                            · {u.rows} row{u.rows === 1 ? "" : "s"}
                          </Text>
                        </Text>
                        <Text style={{ color: chosen ? COLORS.brandPurple : COLORS.textMuted, fontSize: 12 }}>
                          {chosen ? `→ ${chosen}` : "keep as-is"}
                        </Text>
                      </Pressable>

                      {open && (
                        <View style={{ marginTop: 6, marginLeft: 8 }}>
                          <Pressable
                            onPress={() => {
                              setCatMappings((m) => ({ ...m, [u.source]: null }));
                              setActiveUnmatched(null);
                            }}
                            style={{ paddingVertical: 6 }}
                          >
                            <Text style={{ color: chosen === null ? COLORS.brandPurple : COLORS.textMuted, fontSize: 12 }}>
                              Keep “{u.source}” as-is
                            </Text>
                          </Pressable>
                          {preview.envelopeNames.map((name) => (
                            <Pressable
                              key={name}
                              onPress={() => {
                                setCatMappings((m) => ({ ...m, [u.source]: name }));
                                setActiveUnmatched(null);
                              }}
                              style={{ paddingVertical: 6 }}
                            >
                              <Text
                                style={{
                                  color: chosen === name ? COLORS.brandPurple : COLORS.textPrimary,
                                  fontSize: 13,
                                }}
                              >
                                {name}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>

              <Pressable onPress={commitWithMappings} disabled={importCsv.isPending} style={{ marginTop: 8 }}>
                {importCsv.isPending ? (
                  <ActivityIndicator color={COLORS.brandPurple} />
                ) : (
                  <Text style={{ color: COLORS.brandPurple, fontWeight: "600", fontSize: 14 }}>
                    Import transactions
                  </Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => {
                  setPreview(null);
                  setActiveUnmatched(null);
                }}
                style={{ marginTop: 10 }}
              >
                <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>‹ Back to column matching</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ marginTop: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: COLORS.textPrimary, fontSize: 13, flex: 1 }} numberOfLines={1}>
                  {fileName}
                </Text>
                <Pressable onPress={reset} hitSlop={8}>
                  <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>Clear</Text>
                </Pressable>
              </View>

              <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 12, marginBottom: 6 }}>
                Match your columns
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
                      borderColor:
                        f.required && !mapping[f.key] ? COLORS.warning : COLORS.glassBorder,
                    }}
                  >
                    <Text style={{ color: COLORS.textPrimary, fontSize: 13 }}>
                      {f.label}
                      {f.required ? "" : " (optional)"}
                    </Text>
                    <Text
                      style={{
                        color: mapping[f.key] ? COLORS.brandPurple : COLORS.textMuted,
                        fontSize: 12,
                      }}
                    >
                      {mapping[f.key] ?? f.hint}
                    </Text>
                  </Pressable>

                  {activeField === f.key && (
                    <View style={{ marginTop: 6, marginLeft: 8 }}>
                      {!f.required && (
                        <Pressable
                          onPress={() => {
                            setMapping((m) => ({ ...m, [f.key]: undefined }));
                            setActiveField(null);
                          }}
                          style={{ paddingVertical: 6 }}
                        >
                          <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>— none —</Text>
                        </Pressable>
                      )}
                      {headers.map((h) => (
                        <Pressable
                          key={h}
                          onPress={() => {
                            setMapping((m) => ({ ...m, [f.key]: h }));
                            setActiveField(null);
                          }}
                          style={{ paddingVertical: 6 }}
                        >
                          <Text
                            style={{
                              color: mapping[f.key] === h ? COLORS.brandPurple : COLORS.textPrimary,
                              fontSize: 13,
                            }}
                          >
                            {h}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              ))}

              {/* Uniform-sign files are ambiguous, and guessing wrong silently
                  inverts the whole import — so make it a required answer rather
                  than a toggle that quietly defaults to one interpretation. */}
              {signs?.uniform && signs.positive > 0 ? (
                <View style={{ marginTop: 4, marginBottom: 4 }}>
                  <Text style={{ color: COLORS.warning, fontSize: 13, fontWeight: "600" }}>
                    All {signs.parsed} amounts are positive
                  </Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 4, lineHeight: 17 }}>
                    Most bank exports list spending as positive numbers. Which is this?
                  </Text>
                  {([
                    ["spending", "These are purchases — record as money out"],
                    ["deposits", "These are deposits — record as money in"],
                  ] as const).map(([value, label]) => {
                    const active = signChoice === value;
                    return (
                      <Pressable
                        key={value}
                        onPress={() => setSignChoice(value)}
                        style={{
                          marginTop: 8,
                          paddingVertical: 10,
                          paddingHorizontal: 12,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: active ? COLORS.brandPurple : COLORS.glassBorder,
                          backgroundColor: active ? COLORS.insightBg : "transparent",
                        }}
                      >
                        <Text style={{ color: active ? COLORS.brandPurple : COLORS.textPrimary, fontSize: 13 }}>
                          {active ? "✓ " : ""}{label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Pressable onPress={() => setNegate((v) => !v)} style={{ paddingVertical: 8 }}>
                  <Text style={{ color: negate ? COLORS.brandPurple : COLORS.textMuted, fontSize: 12 }}>
                    {negate ? "✓ " : ""}My file uses positive numbers for spending
                  </Text>
                </Pressable>
              )}

              <Pressable
                onPress={runImport}
                disabled={!ready || importCsv.isPending || previewCsv.isPending}
                style={{ marginTop: 8 }}
              >
                {importCsv.isPending || previewCsv.isPending ? (
                  <ActivityIndicator color={COLORS.brandPurple} />
                ) : (
                  <Text
                    style={{
                      color: ready ? COLORS.brandPurple : COLORS.textMuted,
                      fontWeight: "600",
                      fontSize: 14,
                    }}
                  >
                    Import transactions
                  </Text>
                )}
              </Pressable>
            </View>
          )}
        </GlassCard>

        {/* Live connections */}
        <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 1, marginBottom: 10, marginTop: 8 }}>
          LIVE CONNECTIONS
        </Text>

        <GlassCard style={{ marginBottom: 10 }}>
          <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
            Google Sheets
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 6, lineHeight: 18 }}>
            Keeps syncing from a sheet you keep updating — no re-export each time.
          </Text>
          <Pressable
            onPress={() => connectGoogle.mutate(undefined)}
            disabled={connectGoogle.isPending}
            style={{ marginTop: 12 }}
          >
            <Text style={{ color: COLORS.brandPurple, fontWeight: "600", fontSize: 14 }}>
              {connectGoogle.isPending ? "Opening…" : "Connect Google Sheets"}
            </Text>
          </Pressable>
        </GlassCard>

        <GlassCard>
          <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
            Microsoft Excel
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 6, lineHeight: 18 }}>
            Sync a workbook straight from OneDrive — pick the file and tab
            in-app, no re-export each time.
          </Text>
          <Pressable onPress={() => router.push("/import-excel" as never)} style={{ marginTop: 12 }}>
            <Text style={{ color: COLORS.brandPurple, fontWeight: "600", fontSize: 14 }}>
              Open Excel import ›
            </Text>
          </Pressable>
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}
