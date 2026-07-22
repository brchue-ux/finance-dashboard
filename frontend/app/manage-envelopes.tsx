/**
 * Manage Envelopes — create/edit/deactivate budget envelopes and set monthly
 * targets. Reached from the Budget tab (header, and the "Set budget" CTA on any
 * envelope with no target).
 *
 * Envelope names double as transaction categories, so renaming one does not
 * retroactively move past transactions — the Recategorize action is how that
 * gets reconciled.
 */
import { useState } from "react";
import {
  ScrollView,
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { GlassCard } from "@/components/ui/GlassCard";
import { GradientText } from "@/components/ui/GradientText";
import { COLORS } from "@/constants/theme";
import {
  useEnvelopes,
  useCreateEnvelope,
  useUpdateEnvelope,
  useDeleteEnvelope,
  useSeedDefaultEnvelopes,
  useRecategorize,
  type Envelope,
} from "@/hooks/useEnvelopes";

export default function ManageEnvelopesScreen() {
  const router = useRouter();
  const { data, isLoading } = useEnvelopes();
  const create = useCreateEnvelope();
  const update = useUpdateEnvelope();
  const remove = useDeleteEnvelope();
  const seedDefaults = useSeedDefaultEnvelopes();
  const recategorize = useRecategorize();

  const [newName, setNewName] = useState("");
  const [newTarget, setNewTarget] = useState("");

  const envelopes = data?.envelopes ?? [];
  const active = envelopes.filter((e) => e.active);
  const inactive = envelopes.filter((e) => !e.active);

  function addEnvelope() {
    const name = newName.trim();
    const target = Number(newTarget);
    if (!name) return;
    if (!Number.isFinite(target) || target < 0) {
      Alert.alert("Invalid target", "Enter a non-negative number.");
      return;
    }
    create.mutate(
      { name, monthlyTarget: target, categoryRules: [] },
      {
        onSuccess: () => {
          setNewName("");
          setNewTarget("");
        },
        onError: (e) => Alert.alert("Couldn’t create category", String(e)),
      }
    );
  }

  function runRecategorize() {
    Alert.alert(
      "Recategorize transactions",
      "Re-run categorization over stored transactions. Only uncategorized ones are touched, so categories you set by hand are kept.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Run",
          onPress: () =>
            recategorize.mutate(true, {
              onSuccess: (r) =>
                Alert.alert(
                  "Done",
                  `Scanned ${r.scanned}, updated ${r.updated}.`
                ),
              onError: (e) => Alert.alert("Failed", String(e)),
            }),
        },
      ]
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: COLORS.brandPurple, fontSize: 24, marginRight: 4 }}>‹</Text>
          <GradientText style={{ fontSize: 20, fontWeight: "800" }}>Categories</GradientText>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {isLoading ? (
          <ActivityIndicator color={COLORS.brandPurple} style={{ marginTop: 40 }} />
        ) : (
          <>
            {envelopes.length === 0 && (
              <GlassCard style={{ marginBottom: 16 }}>
                <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
                  No categories yet
                </Text>
                <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 6 }}>
                  Start from a default set of Canadian merchant categories, then
                  adjust the targets. Without envelopes every transaction stays
                  uncategorized.
                </Text>
                <Pressable
                  onPress={() => seedDefaults.mutate(undefined)}
                  disabled={seedDefaults.isPending}
                  style={{ marginTop: 12 }}
                >
                  <Text style={{ color: COLORS.brandPurple, fontWeight: "600", fontSize: 14 }}>
                    {seedDefaults.isPending ? "Adding…" : "Use default categories"}
                  </Text>
                </Pressable>
              </GlassCard>
            )}

            {active.map((env) => (
              <EnvelopeRow
                key={env.id}
                envelope={env}
                onSaveTarget={(monthlyTarget) =>
                  update.mutate({ id: env.id, monthlyTarget })
                }
                onDeactivate={() =>
                  Alert.alert(
                    `Deactivate ${env.name}?`,
                    "Past transactions keep this category and stay in your history. You can re-activate it later.",
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Deactivate", style: "destructive", onPress: () => remove.mutate(env.id) },
                    ]
                  )
                }
              />
            ))}

            {/* Add new */}
            <GlassCard style={{ marginTop: 8 }}>
              <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15, marginBottom: 10 }}>
                Add a category
              </Text>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="Name (e.g. Pets)"
                placeholderTextColor={COLORS.textMuted}
                style={inputStyle}
              />
              <TextInput
                value={newTarget}
                onChangeText={setNewTarget}
                placeholder="Monthly target"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="decimal-pad"
                style={[inputStyle, { marginTop: 8 }]}
              />
              <Pressable onPress={addEnvelope} disabled={create.isPending} style={{ marginTop: 12 }}>
                <Text style={{ color: COLORS.brandPurple, fontWeight: "600", fontSize: 14 }}>
                  {create.isPending ? "Adding…" : "Add category"}
                </Text>
              </Pressable>
            </GlassCard>

            {/* Recategorize */}
            <GlassCard style={{ marginTop: 12 }}>
              <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
                Recategorize transactions
              </Text>
              <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 6 }}>
                Categories are assigned when a transaction is imported, so rows
                added before a category existed stay uncategorized until this runs.
              </Text>
              <Pressable onPress={runRecategorize} disabled={recategorize.isPending} style={{ marginTop: 12 }}>
                <Text style={{ color: COLORS.brandPurple, fontWeight: "600", fontSize: 14 }}>
                  {recategorize.isPending ? "Running…" : "Run now"}
                </Text>
              </Pressable>
            </GlassCard>

            {/* Learned rules — the corrections you promoted to standing rules */}
            <Pressable onPress={() => router.push("/manage-learned-rules")}>
              <GlassCard style={{ marginTop: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
                      Learned rules
                    </Text>
                    <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 6 }}>
                      Rules the app learned from your corrections. They take priority
                      over the built-in matching. View or remove them.
                    </Text>
                  </View>
                  <Text style={{ color: COLORS.brandPurple, fontSize: 22 }}>›</Text>
                </View>
              </GlassCard>
            </Pressable>

            {inactive.length > 0 && (
              <View style={{ marginTop: 20 }}>
                <Text style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 8 }}>
                  Inactive
                </Text>
                {inactive.map((env) => (
                  <GlassCard key={env.id} style={{ marginBottom: 8 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ color: COLORS.textMuted, fontSize: 14 }}>{env.name}</Text>
                      <Pressable onPress={() => update.mutate({ id: env.id, active: true })} hitSlop={8}>
                        <Text style={{ color: COLORS.brandPurple, fontSize: 13, fontWeight: "600" }}>
                          Re-activate
                        </Text>
                      </Pressable>
                    </View>
                  </GlassCard>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function EnvelopeRow({
  envelope,
  onSaveTarget,
  onDeactivate,
}: {
  envelope: Envelope;
  onSaveTarget: (target: number) => void;
  onDeactivate: () => void;
}) {
  const [value, setValue] = useState(String(envelope.monthlyTarget));
  const parsed = Number(value);
  const dirty = value !== String(envelope.monthlyTarget);
  const valid = Number.isFinite(parsed) && parsed >= 0;

  return (
    <GlassCard style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: COLORS.textPrimary, fontWeight: "600", fontSize: 15 }}>
          {envelope.name}
        </Text>
        <Pressable onPress={onDeactivate} hitSlop={8}>
          <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>Deactivate</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10, gap: 10 }}>
        <Text style={{ color: COLORS.textMuted, fontSize: 13 }}>Monthly</Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          keyboardType="decimal-pad"
          style={[inputStyle, { flex: 1, marginTop: 0 }]}
        />
        {dirty && (
          <Pressable onPress={() => valid && onSaveTarget(parsed)} hitSlop={8}>
            <Text
              style={{
                color: valid ? COLORS.brandPurple : COLORS.textMuted,
                fontWeight: "600",
                fontSize: 13,
              }}
            >
              Save
            </Text>
          </Pressable>
        )}
      </View>

      {envelope.monthlyTarget <= 0 && (
        <Text style={{ color: COLORS.warning, fontSize: 12, marginTop: 8 }}>
          No budget set — this category is excluded from budget totals.
        </Text>
      )}
      {envelope.categoryRules.length === 0 && (
        <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 6 }}>
          No merchant rules — transactions won’t auto-match to this category.
        </Text>
      )}
    </GlassCard>
  );
}

const inputStyle = {
  backgroundColor: COLORS.glassBg,
  borderWidth: 1,
  borderColor: COLORS.glassBorder,
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 10,
  color: COLORS.textPrimary,
  fontSize: 14,
} as const;
