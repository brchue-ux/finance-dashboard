import { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from "react-native";
import { COLORS } from "@/constants/theme";
import { getApiUrl, getSessionToken } from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ConversationSheetProps {
  visible: boolean;
  onClose: () => void;
  view: "budget" | "portfolio";
  alertContext?: string;
  initialCards?: unknown[];
}

const MAX_MESSAGES = 20;

export function ConversationSheet({
  visible,
  onClose,
  view,
  alertContext,
  initialCards,
}: ConversationSheetProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  async function send() {
    if (!input.trim() || isStreaming) return;

    const userMessage: Message = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage].slice(-MAX_MESSAGES);
    setMessages(newMessages);
    setInput("");
    setIsStreaming(true);

    const assistantMessage: Message = { role: "assistant", content: "" };
    setMessages([...newMessages, assistantMessage]);

    try {
      const token = await getSessionToken();
      const res = await fetch(`${getApiUrl()}/api/llm/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ view, messages: newMessages, alertContext }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        // Parse Vercel AI SDK data stream format
        for (const line of chunk.split("\n")) {
          if (line.startsWith("0:")) {
            try {
              const text = JSON.parse(line.slice(2));
              accumulated += text;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: accumulated };
                return updated;
              });
            } catch {}
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: "Sorry, something went wrong. Please try again.",
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: "rgba(0,0,0,0.5)",
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{
            backgroundColor: "#1A1826",
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            maxHeight: "85%",
            minHeight: "50%",
          }}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: COLORS.glassBorder,
            }}
          >
            <Text style={{ color: COLORS.textPrimary, fontWeight: "700", fontSize: 16 }}>
              Ask Claude
            </Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={{ color: COLORS.textMuted, fontSize: 20 }}>✕</Text>
            </Pressable>
          </View>

          {/* Messages */}
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1, padding: 16 }}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {messages.length === 0 && (
              <Text style={{ color: COLORS.textMuted, fontSize: 14, textAlign: "center", marginTop: 32 }}>
                Ask anything about your {view === "budget" ? "budget" : "portfolio"}
              </Text>
            )}
            {messages.map((msg, i) => (
              <View
                key={i}
                style={{
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  backgroundColor:
                    msg.role === "user" ? COLORS.brandPurple : COLORS.glassBg,
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 8,
                }}
              >
                <Text style={{ color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 }}>
                  {msg.content}
                  {msg.role === "assistant" && isStreaming && i === messages.length - 1
                    ? "▊"
                    : ""}
                </Text>
              </View>
            ))}
          </ScrollView>

          {/* Input bar */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              padding: 12,
              borderTopWidth: 1,
              borderTopColor: COLORS.glassBorder,
              gap: 8,
            }}
          >
            <TextInput
              style={{
                flex: 1,
                backgroundColor: COLORS.glassBg,
                borderWidth: 1,
                borderColor: COLORS.glassBorder,
                borderRadius: 20,
                paddingHorizontal: 16,
                paddingVertical: 10,
                color: COLORS.textPrimary,
                fontSize: 14,
                maxHeight: 100,
              }}
              placeholder="Ask a follow-up..."
              placeholderTextColor={COLORS.textMuted}
              value={input}
              onChangeText={setInput}
              multiline
              onSubmitEditing={send}
            />
            <Pressable
              onPress={send}
              disabled={isStreaming || !input.trim()}
              style={{
                backgroundColor: input.trim() && !isStreaming ? COLORS.brandPurple : COLORS.glassBg,
                borderRadius: 20,
                width: 40,
                height: 40,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: COLORS.textPrimary, fontSize: 16 }}>↑</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
