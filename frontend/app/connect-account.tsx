/**
 * Account connection.
 *
 * Two modes, because the locked decision covers first-run onboarding while the
 * Banks tab's "+ Add account" is a different job:
 *
 *  - wizard (default): the initial connections chained into one continuous
 *    sitting with a visual step indicator, auto-advancing as each browser
 *    handoff returns — explicitly not "4 independent buttons the user has to
 *    discover and trigger separately", which is what this screen used to be.
 *  - ?mode=single: one connection, for adding an account later.
 *
 * Each step still opens its own browser session underneath: Plaid can't combine
 * several institutions into one Hosted Link session, and SnapTrade is a separate
 * vendor. The wizard packages that reality into one sitting; it doesn't remove it.
 *
 * The Plaid/SnapTrade mechanics stay in useConnect, untouched — that path is
 * device-verified working and this screen only sequences it.
 */
import { useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { GlassCard } from "@/components/ui/GlassCard";
import { GradientText } from "@/components/ui/GradientText";
import { COLORS } from "@/constants/theme";
import { useConnectBank, useConnectBrokerage, type ConnectOutcome } from "@/hooks/useConnect";

// "spreadsheet" is a population path like the other two, so it belongs in the
// wizard — but it is not an OAuth handoff: it routes to the importer instead of
// opening a browser session, and completes when the user comes back.
type StepKind = "bank" | "brokerage" | "spreadsheet";
type StepState = "pending" | "connected" | "skipped";

interface Step {
  key: string;
  kind: StepKind;
  title: string;
  subtitle: string;
}

/**
 * Bank steps are mechanically identical — the labels are guidance only, since
 * the user picks the actual institution inside Plaid's own UI. Three bank slots
 * plus the brokerage matches the four initial connections in the spec.
 */
const WIZARD_STEPS: Step[] = [
  { key: "bank-1", kind: "bank", title: "Your main bank", subtitle: "Chequing and credit cards" },
  { key: "bank-2", kind: "bank", title: "A second bank", subtitle: "If you use more than one" },
  { key: "bank-3", kind: "bank", title: "A third bank", subtitle: "Optional" },
  { key: "brokerage", kind: "brokerage", title: "Wealthsimple", subtitle: "Investments, via SnapTrade" },
  { key: "spreadsheet", kind: "spreadsheet", title: "A spreadsheet", subtitle: "CSV or Excel export from any institution" },
];

const SINGLE_STEPS: Step[] = [
  { key: "bank-1", kind: "bank", title: "Bank account", subtitle: "Chequing, savings and credit cards" },
  { key: "brokerage", kind: "brokerage", title: "Investment account", subtitle: "Wealthsimple and others" },
  { key: "spreadsheet", kind: "spreadsheet", title: "Spreadsheet import", subtitle: "CSV or Excel export from any institution" },
];

export default function ConnectAccountScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const wizard = mode !== "single";
  const steps = wizard ? WIZARD_STEPS : SINGLE_STEPS;

  const bank = useConnectBank();
  const brokerage = useConnectBrokerage();
  const busy = bank.isPending || brokerage.isPending;

  const [index, setIndex] = useState(0);
  const [states, setStates] = useState<Record<string, StepState>>({});
  const [done, setDone] = useState(false);

  const step = steps[index];
  const connectedCount = Object.values(states).filter((s) => s === "connected").length;

  function advance(from: number) {
    if (from + 1 >= steps.length) setDone(true);
    else setIndex(from + 1);
  }

  async function runStep(s: Step, at: number) {
    // Not a browser handoff — hand off to the importer screen. Mark it done on
    // the way out so returning to the wizard doesn't strand the user on a step
    // they already dealt with.
    if (s.kind === "spreadsheet") {
      setStates((prev) => ({ ...prev, [s.key]: "connected" }));
      if (wizard && at + 1 < steps.length) setIndex(at + 1);
      router.push("/import");
      return;
    }
    const mutation = s.kind === "bank" ? bank : brokerage;
    try {
      const outcome: ConnectOutcome = await mutation.mutateAsync();
      if (outcome === "connected") {
        setStates((prev) => ({ ...prev, [s.key]: "connected" }));
        if (wizard) advance(at);
        else setDone(true);
        return;
      }
      // Cancelled: stay on this step so it can be retried. Auto-advancing here
      // would quietly carry the user past a connection they meant to make.
    } catch (e) {
      Alert.alert("Couldn’t connect", String(e));
    }
  }

  function skip(s: Step, at: number) {
    setStates((prev) => ({ ...prev, [s.key]: "skipped" }));
    advance(at);
  }

  if (done) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 40 }}>
          <GradientText style={{ fontSize: 26, fontWeight: "800", marginBottom: 8 }}>
            {connectedCount > 0 ? "All set" : "Nothing connected"}
          </GradientText>
          <Text style={{ color: COLORS.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 20 }}>
            {connectedCount > 0
              ? `Connected ${connectedCount} account${connectedCount === 1 ? "" : "s"}. Transactions sync in the background, so the Banks tab will fill in shortly.`
              : "You can connect accounts any time from the Banks tab."}
          </Text>
          <Pressable onPress={() => router.back()}>
            <Text style={{ color: COLORS.brandPurple, fontWeight: "600", fontSize: 15 }}>Done</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          disabled={busy}
          style={{ flexDirection: "row", alignItems: "center", opacity: busy ? 0.4 : 1 }}
        >
          <Text style={{ color: COLORS.brandPurple, fontSize: 24, marginRight: 4 }}>‹</Text>
          <GradientText style={{ fontSize: 20, fontWeight: "800" }}>
            {wizard ? "Connect your accounts" : "Add an account"}
          </GradientText>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {wizard && <StepIndicator steps={steps} index={index} states={states} />}

        <GlassCard style={{ marginTop: wizard ? 20 : 0 }}>
          {wizard && (
            <Text style={{ color: COLORS.textMuted, fontSize: 12, marginBottom: 6 }}>
              Step {index + 1} of {steps.length}
            </Text>
          )}
          <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 17 }}>
            {step.title}
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 6, lineHeight: 19 }}>
            {step.subtitle}
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 10, lineHeight: 18 }}>
            {step.kind === "bank"
              ? "Opens your bank’s own secure login. This app never sees your banking credentials."
              : step.kind === "spreadsheet"
                ? "Pick a CSV or Excel file exported from your bank. Useful for accounts that can’t be connected directly, or for history older than a live connection provides."
                : "Opens SnapTrade’s secure portal to authorize read-only access to your holdings."}
          </Text>

          <Pressable onPress={() => runStep(step, index)} disabled={busy} style={{ marginTop: 16 }}>
            {busy ? (
              <ActivityIndicator color={COLORS.brandPurple} />
            ) : (
              <Text style={{ color: COLORS.brandPurple, fontWeight: "700", fontSize: 15 }}>
                {step.kind === "bank"
                  ? "Connect a bank"
                  : step.kind === "spreadsheet"
                    ? "Choose a file"
                    : "Connect Wealthsimple"}
              </Text>
            )}
          </Pressable>
        </GlassCard>

        {wizard && (
          <Pressable
            onPress={() => skip(step, index)}
            disabled={busy}
            style={{ marginTop: 16, alignSelf: "center" }}
          >
            <Text style={{ color: COLORS.textMuted, fontSize: 13 }}>
              {index + 1 === steps.length ? "Finish without this" : "Skip this step"}
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Graphical progress: the decision asks for a visual indicator, not just text. */
function StepIndicator({
  steps,
  index,
  states,
}: {
  steps: Step[];
  index: number;
  states: Record<string, StepState>;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {steps.map((s, i) => {
        const state = states[s.key];
        const isCurrent = i === index;
        const fill =
          state === "connected"
            ? COLORS.success
            : isCurrent
              ? COLORS.brandPurple
              : COLORS.glassBorder;

        return (
          <View key={s.key} style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: fill,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  color: state === "connected" || isCurrent ? "#fff" : COLORS.textMuted,
                  fontSize: 12,
                  fontWeight: "700",
                }}
              >
                {state === "connected" ? "✓" : state === "skipped" ? "–" : i + 1}
              </Text>
            </View>
            {i < steps.length - 1 && (
              <View
                style={{
                  flex: 1,
                  height: 2,
                  backgroundColor: state === "connected" ? COLORS.success : COLORS.glassBorder,
                  marginHorizontal: 4,
                }}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}
