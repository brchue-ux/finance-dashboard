/**
 * Split editor — divides one transaction across several envelopes.
 *
 * The backend refuses any set whose parts don't sum to the transaction, so the
 * remainder is shown live and Save stays disabled until it's zero. Discovering
 * a 400 after typing is a worse experience than never being able to submit an
 * invalid set in the first place.
 *
 * Amounts are entered as positive magnitudes and signed to match the parent on
 * save — asking someone to type minus signs to split a purchase is a needless
 * trap, and a wrong sign is rejected server-side anyway.
 */
import { useEffect, useState } from "react";
import { View, Text, Pressable, TextInput, ActivityIndicator, Alert, ScrollView } from "react-native";
import { COLORS } from "@/constants/theme";
import { useEnvelopes } from "@/hooks/useEnvelopes";
import { useSplits, useSaveSplits, useClearSplits, type Split } from "@/hooks/useSplits";

interface Draft {
  category: string;
  amount: string;
}

/** Matches the server's tolerance so the client never enables an invalid save. */
const EPSILON = 0.005;

export function SplitEditor({
  transactionId,
  transactionAmount,
  description,
  onDone,
}: {
  transactionId: string;
  transactionAmount: number;
  description: string;
  onDone: () => void;
}) {
  const { data, isLoading } = useSplits(transactionId);
  const { data: envelopeData } = useEnvelopes();
  const save = useSaveSplits(transactionId);
  const clear = useClearSplits(transactionId);

  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [picking, setPicking] = useState<number | null>(null);

  const envelopes = (envelopeData?.envelopes ?? []).filter((e) => e.active);
  const total = Math.abs(transactionAmount);

  // Seed from existing splits, or start a two-row draft with the full amount on
  // the first row so the remainder starts at zero and only moves as you edit.
  useEffect(() => {
    if (drafts !== null || isLoading || !data) return;
    if (data.splits.length > 0) {
      setDrafts(data.splits.map((s) => ({ category: s.category, amount: Math.abs(s.amount).toFixed(2) })));
    } else {
      setDrafts([
        { category: envelopes[0]?.name ?? "", amount: total.toFixed(2) },
        { category: "", amount: "" },
      ]);
    }
  }, [data, isLoading, drafts, envelopes, total]);

  if (isLoading || drafts === null) {
    return <ActivityIndicator color={COLORS.brandPurple} style={{ marginVertical: 24 }} />;
  }

  const parsed = drafts.map((d) => (d.amount.trim() === "" ? 0 : Number(d.amount)));
  const anyInvalid = parsed.some((n) => !Number.isFinite(n) || n < 0);
  const allocated = parsed.reduce((s, n) => s + n, 0);
  const remainder = total - allocated;
  const filled = drafts.filter((d, i) => d.category && parsed[i] > 0);
  const balanced = Math.abs(remainder) <= EPSILON;
  const canSave = balanced && !anyInvalid && filled.length >= 2;

  function update(i: number, patch: Partial<Draft>) {
    setDrafts((d) => d!.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }

  /** Puts whatever is unallocated onto a row, so balancing is one tap. */
  function fillRemainder(i: number) {
    const others = parsed.reduce((s, n, j) => (j === i ? s : s + n), 0);
    update(i, { amount: Math.max(0, total - others).toFixed(2) });
  }

  function onSave() {
    const sign = transactionAmount < 0 ? -1 : 1;
    const payload: Split[] = drafts!
      .map((d, i) => ({ category: d.category, amount: sign * parsed[i] }))
      .filter((s) => s.category && s.amount !== 0);

    save.mutate(payload, {
      onSuccess: onDone,
      onError: (e) => Alert.alert("Couldn’t save split", String(e)),
    });
  }

  function onClear() {
    Alert.alert("Remove split?", "The whole amount goes back to the transaction's own category.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          clear.mutate(undefined, {
            onSuccess: onDone,
            onError: (e) => Alert.alert("Couldn’t remove split", String(e)),
          }),
      },
    ]);
  }

  const hasExisting = (data?.splits.length ?? 0) > 0;

  return (
    <View>
      <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 15 }} numberOfLines={1}>
        {description}
      </Text>
      <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 2, marginBottom: 14 }}>
        Splitting ${total.toFixed(2)}
      </Text>

      {drafts.map((d, i) => (
        <View key={i} style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable
              onPress={() => setPicking(picking === i ? null : i)}
              style={{
                flex: 1,
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: d.category ? COLORS.glassBorder : COLORS.warning,
                backgroundColor: COLORS.glassBg,
              }}
            >
              <Text style={{ color: d.category ? COLORS.textPrimary : COLORS.textMuted, fontSize: 14 }}>
                {d.category || "Choose category"}
              </Text>
            </Pressable>

            <TextInput
              value={d.amount}
              onChangeText={(v) => update(i, { amount: v })}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={COLORS.textMuted}
              style={{
                width: 96,
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: COLORS.glassBorder,
                backgroundColor: COLORS.glassBg,
                color: COLORS.textPrimary,
                fontSize: 14,
                textAlign: "right",
              }}
            />

            {drafts.length > 2 && (
              <Pressable onPress={() => setDrafts((s) => s!.filter((_, j) => j !== i))} hitSlop={8}>
                <Text style={{ color: COLORS.textMuted, fontSize: 18 }}>×</Text>
              </Pressable>
            )}
          </View>

          {Math.abs(remainder) > EPSILON && (
            <Pressable onPress={() => fillRemainder(i)} style={{ paddingTop: 6 }}>
              <Text style={{ color: COLORS.brandPurple, fontSize: 12 }}>
                Put remaining ${Math.abs(remainder).toFixed(2)} here
              </Text>
            </Pressable>
          )}

          {picking === i && (
            <ScrollView style={{ maxHeight: 180, marginTop: 6 }}>
              {envelopes.map((e) => (
                <Pressable
                  key={e.id}
                  onPress={() => {
                    update(i, { category: e.name });
                    setPicking(null);
                  }}
                  style={{ paddingVertical: 8, paddingHorizontal: 12 }}
                >
                  <Text
                    style={{
                      color: d.category === e.name ? COLORS.brandPurple : COLORS.textPrimary,
                      fontSize: 14,
                    }}
                  >
                    {e.name}
                  </Text>
                </Pressable>
              ))}
              {envelopes.length === 0 && (
                <Text style={{ color: COLORS.textMuted, fontSize: 13, padding: 12 }}>
                  No categories yet — create some first.
                </Text>
              )}
            </ScrollView>
          )}
        </View>
      ))}

      <Pressable
        onPress={() => setDrafts((d) => [...d!, { category: "", amount: "" }])}
        style={{ paddingVertical: 8 }}
      >
        <Text style={{ color: COLORS.brandPurple, fontSize: 13, fontWeight: "600" }}>
          + Add another part
        </Text>
      </Pressable>

      {/* Live remainder — the whole reason Save can be trusted. */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          paddingVertical: 10,
          borderTopWidth: 1,
          borderTopColor: COLORS.glassBorder,
          marginTop: 4,
        }}
      >
        <Text style={{ color: COLORS.textMuted, fontSize: 13 }}>
          {balanced ? "Balanced" : remainder > 0 ? "Unallocated" : "Over by"}
        </Text>
        <Text
          style={{
            color: balanced ? COLORS.success : COLORS.warning,
            fontSize: 13,
            fontWeight: "600",
          }}
        >
          {balanced ? `$${total.toFixed(2)}` : `$${Math.abs(remainder).toFixed(2)}`}
        </Text>
      </View>

      {!canSave && !balanced && (
        <Text style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 8 }}>
          Parts must add up to ${total.toFixed(2)} exactly.
        </Text>
      )}
      {!canSave && balanced && filled.length < 2 && (
        <Text style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 8 }}>
          A split needs at least two categories.
        </Text>
      )}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 20, marginTop: 6 }}>
        <Pressable onPress={onSave} disabled={!canSave || save.isPending}>
          {save.isPending ? (
            <ActivityIndicator color={COLORS.brandPurple} />
          ) : (
            <Text
              style={{
                color: canSave ? COLORS.brandPurple : COLORS.textMuted,
                fontWeight: "700",
                fontSize: 15,
              }}
            >
              Save split
            </Text>
          )}
        </Pressable>

        <Pressable onPress={onDone} disabled={save.isPending}>
          <Text style={{ color: COLORS.textMuted, fontSize: 14 }}>Cancel</Text>
        </Pressable>

        {hasExisting && (
          <Pressable onPress={onClear} disabled={clear.isPending} style={{ marginLeft: "auto" }}>
            <Text style={{ color: COLORS.danger, fontSize: 13 }}>Remove split</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
