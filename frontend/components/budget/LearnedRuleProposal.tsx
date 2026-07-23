/**
 * "Make this a rule?" — the step after a manual correction (build-reminders 6b).
 *
 * The user just re-filed one transaction. This offers to make that stick for the
 * merchant, and it does the one thing the industry aggregators can't do for us:
 * it lets the user set the boundary. We propose the narrowest safe pattern (the
 * normalized description) and show, live, what any pattern would catch AND where
 * those rows sit now — because "catches 12" is not enough to decide by. Twelve
 * uncategorized rows is a clean win; twelve rows already filed in Restaurants is
 * a move the user should get to see before agreeing to it.
 *
 * Nothing is imposed: the default is narrow, widening is a deliberate edit, and
 * the count is always in front of the Save button.
 */
import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { COLORS } from "@/constants/theme";
import { useLearnedRulePreview, useSaveLearnedRule, type RulePreview } from "@/hooks/useLearnedRules";

const UNCATEGORIZED = "uncategorized";
const DEBOUNCE_MS = 350;

/** Small two-state scope selector chip, matching the app's chip idiom. */
function ScopeChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: active ? COLORS.brandPurple : COLORS.glassBorder,
        backgroundColor: active ? "rgba(124,58,237,0.15)" : "transparent",
      }}
    >
      <Text
        style={{ color: active ? COLORS.textPrimary : COLORS.textMuted, fontSize: 13, fontWeight: "600" }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function LearnedRuleProposal({
  transactionId,
  category,
  onDone,
}: {
  transactionId: string;
  category: string;
  onDone: () => void;
}) {
  const preview = useLearnedRulePreview();
  const save = useSaveLearnedRule();

  // `pattern` is the editable text; `result` is the last preview we got back.
  // Null until the default proposal loads.
  const [pattern, setPattern] = useState<string | null>(null);
  const [result, setResult] = useState<RulePreview | null>(null);

  // Scope (rules are SCOPED, not catch-all). The triggering row's account comes
  // back on the first preview; scoping to it is a one-tap choice, not a picker.
  const [account, setAccount] = useState<{ id: string; name: string } | null>(null);
  const [thisAccountOnly, setThisAccountOnly] = useState(false);
  const [futureOnly, setFutureOnly] = useState(false);

  // Seed the pattern from the default proposal for this transaction. The
  // [pattern] effect below does every preview after that, so this call only
  // establishes the starting text.
  useEffect(() => {
    preview.mutate(
      { transactionId },
      {
        onSuccess: (r) => {
          setPattern(r.pattern);
          if (r.accountId) setAccount({ id: r.accountId, name: r.accountName ?? "this account" });
        },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId]);

  // Re-preview whenever the pattern or the account scope settles, debounced so
  // a preview isn't fired on every keystroke. Counts always reflect the scope
  // being saved — an account-scoped rule shows only that account's catches.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (pattern === null) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const trimmed = pattern.trim();
      if (trimmed === "") {
        setResult(null);
        return;
      }
      preview.mutate(
        { pattern: trimmed, ...(thisAccountOnly && account ? { accountId: account.id } : {}) },
        { onSuccess: setResult }
      );
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, thisAccountOnly]);

  function onSave() {
    const trimmed = (pattern ?? "").trim();
    if (trimmed === "") return;
    save.mutate(
      {
        pattern: trimmed,
        category,
        learnedFromTransactionId: transactionId,
        ...(thisAccountOnly && account ? { accountId: account.id } : {}),
        ...(futureOnly ? { futureOnly: true } : {}),
      },
      {
        onSuccess: onDone,
        onError: (e: unknown) =>
          Alert.alert("Could not save rule", e instanceof Error ? e.message : "Something went wrong."),
      }
    );
  }

  const loadingDefault = pattern === null;

  return (
    // No flex:1 — same reason as CategoryPicker: this renders in a content-sized
    // bottom sheet, where a flex:1 root collapses to zero height.
    <View style={{ backgroundColor: COLORS.background, padding: 16 }}>
      <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 18 }}>
        Make this a rule?
      </Text>
      <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 4 }}>
        File matching transactions as{" "}
        <Text style={{ color: COLORS.textPrimary, fontWeight: "600" }}>{category}</Text> from now on.
      </Text>

      {loadingDefault ? (
        <ActivityIndicator style={{ marginTop: 32 }} color={COLORS.textMuted} />
      ) : (
        <>
          <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 20, marginBottom: 6 }}>
            MATCH WHEN THE DESCRIPTION CONTAINS
          </Text>
          <TextInput
            value={pattern ?? ""}
            onChangeText={setPattern}
            autoCapitalize="characters"
            autoCorrect={false}
            style={{
              color: COLORS.textPrimary,
              fontSize: 16,
              backgroundColor: COLORS.glassBg,
              borderWidth: 1,
              borderColor: COLORS.glassBorder,
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
          />
          <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 6 }}>
            Widen it to catch more (e.g. drop the location), or narrow it to catch fewer.
          </Text>

          {/* Scope — rules are scoped, not catch-all. Both rows default to the
              widest choice; narrowing is a visible tap, mirroring the pattern
              box's propose-don't-impose stance. */}
          <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 16, marginBottom: 6 }}>
            WHERE IT APPLIES
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <ScopeChip label="All accounts" active={!thisAccountOnly} onPress={() => setThisAccountOnly(false)} />
            {account && (
              <ScopeChip
                label={`Only ${account.name}`}
                active={thisAccountOnly}
                onPress={() => setThisAccountOnly(true)}
              />
            )}
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <ScopeChip label="Past + future" active={!futureOnly} onPress={() => setFutureOnly(false)} />
            <ScopeChip label="Future only" active={futureOnly} onPress={() => setFutureOnly(true)} />
          </View>

          <ImpactSummary result={result} target={category} pending={preview.isPending} futureOnly={futureOnly} />
        </>
      )}

      <View style={{ flexDirection: "row", gap: 12, marginTop: 20 }}>
        <Pressable
          onPress={onDone}
          disabled={save.isPending}
          style={{ flex: 1, paddingVertical: 14, alignItems: "center" }}
        >
          <Text style={{ color: COLORS.textMuted, fontSize: 15 }}>Not now</Text>
        </Pressable>
        <Pressable
          onPress={onSave}
          disabled={save.isPending || loadingDefault || (pattern ?? "").trim() === ""}
          style={{
            flex: 1,
            paddingVertical: 14,
            alignItems: "center",
            backgroundColor: COLORS.success,
            borderRadius: 8,
            opacity: save.isPending || loadingDefault ? 0.6 : 1,
          }}
        >
          <Text style={{ color: COLORS.background, fontSize: 15, fontWeight: "700" }}>
            {save.isPending ? "Saving…" : "Save rule"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The count and its breakdown — the safety check. Rows already in the target
 * envelope are a no-op; rows in another envelope will MOVE and are flagged; rows
 * uncategorized are the clean win.
 */
function ImpactSummary({
  result,
  target,
  pending,
  futureOnly,
}: {
  result: RulePreview | null;
  target: string;
  pending: boolean;
  futureOnly: boolean;
}) {
  if (!result) {
    return (
      <View style={{ marginTop: 16, height: 20, justifyContent: "center" }}>
        {pending ? <ActivityIndicator color={COLORS.textMuted} /> : null}
      </View>
    );
  }

  const entries = Object.entries(result.byCurrentCategory);
  const targetKey = target.trim().toLowerCase();

  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ color: COLORS.textPrimary, fontSize: 15, fontWeight: "600" }}>
        {futureOnly
          ? `Matches ${result.catches} past transaction${result.catches === 1 ? "" : "s"} — none will move`
          : `Catches ${result.catches} transaction${result.catches === 1 ? "" : "s"}`}
        {pending ? "  …" : ""}
      </Text>
      {futureOnly && (
        <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 4 }}>
          Only new transactions from today on will be filed as {target}.
        </Text>
      )}
      {/* The move/fill breakdown only matters when history will actually be
          re-filed — under future-only it would warn about moves that won't happen. */}
      {!futureOnly && entries.length > 0 && (
        <View style={{ marginTop: 8, gap: 4 }}>
          {entries.map(([cat, n]) => {
            const isTarget = cat.trim().toLowerCase() === targetKey;
            const isUncat = cat === UNCATEGORIZED;
            // A row leaving another envelope is the one thing worth a second
            // look, so it gets the warning colour; the rest are neutral.
            const color = isTarget || isUncat ? COLORS.textMuted : COLORS.warning;
            const label = isTarget
              ? `already in ${cat}`
              : isUncat
                ? "uncategorized"
                : `currently in ${cat} — will move`;
            return (
              <Text key={cat} style={{ color, fontSize: 13 }}>
                {n} {label}
              </Text>
            );
          })}
        </View>
      )}
    </View>
  );
}
