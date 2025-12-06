import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, MessageSquare, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  encryptMessage,
  decryptMessage,
  getIdentityPrivateKey,
  getPqcPrivateKey,
  type HybridEncryptedMessage,
} from "@/lib/crypto";

interface ChatWindowProps {
  conversationId: string | null;
  currentUserId: string;
}

interface Message {
  id: string;
  content: string;
  sender_id: string;
  created_at: string;
  profiles: {
    username: string;
    public_key?: string;
    pqc_public_key?: string;
  };
}

interface DecryptedMessage extends Message {
  decryptedContent?: string;
  isPending?: boolean;
}

const ChatWindow = ({ conversationId, currentUserId }: ChatWindowProps) => {
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [recipientPublicKey, setRecipientPublicKey] = useState<string | null>(
    null
  );
  const [recipientPqcPublicKey, setRecipientPqcPublicKey] = useState<
    string | null
  >(null);
  const [recipientProfile, setRecipientProfile] = useState<any>(null); // ✅ NEW: Store recipient profile info
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ✅ Local cache for own messages plaintext
  const ownMessagesCache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!conversationId) return;

    ownMessagesCache.current.clear();
    loadMessages();
    loadRecipientPublicKey();

    const channel = supabase
      .channel(`conversation-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          console.log("📨 New message received via realtime:", payload);

          if (payload.new && payload.new.sender_id !== currentUserId) {
            console.log("🔄 Reloading messages (from other user)");
            loadMessages();
          } else {
            console.log(
              "⭐ Skipping reload (own message already added optimistically)"
            );
          }
        }
      )
      // ✅ NEW: Listen for profile updates (when recipient generates new keys)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
        },
        (payload) => {
          console.log("🔑 Profile updated:", payload);
          // Reload recipient keys to check if they now have keys
          loadRecipientPublicKey();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, currentUserId]);

  const loadRecipientPublicKey = async () => {
    if (!conversationId) return;

    try {
      console.log(
        "🔑 Loading recipient public keys for conversation:",
        conversationId
      );

      const { data: participants, error } = await supabase
        .from("conversation_participants")
        .select(
          "user_id, profiles!conversation_participants_user_id_fkey(public_key, pqc_public_key)"
        )
        .eq("conversation_id", conversationId)
        .neq("user_id", currentUserId);

      if (error) {
        console.error("❌ Error loading recipient keys:", error);
        return;
      }

      console.log("✅ Participants data:", participants);

      if (participants && participants[0]) {
        const profile = participants[0].profiles as any;
        setRecipientPublicKey(profile?.public_key || null);
        setRecipientPqcPublicKey(profile?.pqc_public_key || null);
        console.log("✅ Recipient keys loaded:", {
          hasClassicalKey: !!profile?.public_key,
          hasPqcKey: !!profile?.pqc_public_key,
        });
      } else {
        console.warn("⚠️ No recipient found in conversation");
      }
    } catch (error) {
      console.error("💥 Unexpected error loading recipient keys:", error);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadMessages = async () => {
    if (!conversationId) return;

    console.log("📥 Loading messages for conversation:", conversationId);

    try {
      const { data: messagesData, error } = await supabase
        .from("messages")
        .select("id, content, sender_id, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("❌ Error loading messages:", error);
        toast.error(`Failed to load messages: ${error.message}`);
        return;
      }

      console.log(`✅ Loaded ${messagesData?.length || 0} messages`);

      if (!messagesData || messagesData.length === 0) {
        setMessages([]);
        return;
      }

      const senderIds = [...new Set(messagesData.map((m) => m.sender_id))];
      const { data: profilesData, error: profileError } = await supabase
        .from("profiles")
        .select("id, username, public_key, pqc_public_key")
        .in("id", senderIds);

      if (profileError) {
        console.error("❌ Error loading profiles:", profileError);
      }

      const data = messagesData.map((msg) => ({
        ...msg,
        profiles: profilesData?.find((p) => p.id === msg.sender_id) || {
          username: "Unknown",
          public_key: null,
          pqc_public_key: null,
        },
      }));

      if (data) {
        const decryptedMessages = await Promise.all(
          data.map(async (msg: any) => {
            const decryptedMessage = { ...msg } as DecryptedMessage;
            const isOwnMessage = msg.sender_id === currentUserId;

            if (isOwnMessage) {
              const cachedPlaintext = ownMessagesCache.current.get(msg.id);
              if (cachedPlaintext) {
                console.log("✅ Using cached plaintext for message:", msg.id);
                decryptedMessage.decryptedContent = cachedPlaintext;
              } else {
                try {
                  const parsed = JSON.parse(msg.content);

                  if (parsed.forSender) {
                    console.log("🔓 Decrypting own message from forSender...");
                    // ✅ Pass currentUserId to decryptMessage
                    const identityPrivateKey =
                      getIdentityPrivateKey(currentUserId);
                    const pqcPrivateKey = getPqcPrivateKey(currentUserId);

                    if (identityPrivateKey && pqcPrivateKey) {
                      try {
                        const decrypted = await decryptMessage(
                          parsed.forSender,
                          parsed.forSender.ephemeralPublicKey,
                          currentUserId, // ✅ Pass userId
                          false
                        );
                        decryptedMessage.decryptedContent = decrypted;
                        ownMessagesCache.current.set(msg.id, decrypted);
                        console.log("✅ Decrypted and cached own message");
                      } catch (decryptError) {
                        console.error(
                          "❌ Failed to decrypt own message:",
                          decryptError
                        );
                        decryptedMessage.decryptedContent =
                          "🔒 [Old message - encrypted with previous keys]";
                      }
                    } else {
                      decryptedMessage.decryptedContent = "[Missing keys]";
                    }
                  } else if (parsed.ciphertext) {
                    decryptedMessage.decryptedContent =
                      "[Your encrypted message]";
                  } else {
                    decryptedMessage.decryptedContent = msg.content;
                  }
                } catch (error) {
                  console.error("❌ Error parsing own message:", error);
                  decryptedMessage.decryptedContent = msg.content;
                }
              }
            } else {
              try {
                // ✅ Pass currentUserId to get correct keys
                const identityPrivateKey = getIdentityPrivateKey(currentUserId);
                const pqcPrivateKey = getPqcPrivateKey(currentUserId);

                if (identityPrivateKey && pqcPrivateKey) {
                  try {
                    const parsed = JSON.parse(msg.content);
                    const encryptedData = parsed.forRecipient || parsed;

                    console.log(
                      "🔓 Attempting to decrypt message from:",
                      msg.profiles?.username
                    );

                    const decrypted = await decryptMessage(
                      encryptedData,
                      encryptedData.ephemeralPublicKey,
                      currentUserId, // ✅ Pass userId
                      false
                    );
                    decryptedMessage.decryptedContent = decrypted;
                    console.log("✅ Decryption successful");
                  } catch (parseError) {
                    console.warn("⚠️ Cannot decrypt message");
                    decryptedMessage.decryptedContent = "[❌ Cannot decrypt]";
                  }
                } else {
                  console.error("❌ Missing own keys for decryption");
                  decryptedMessage.decryptedContent =
                    "[Missing keys - cannot decrypt]";
                }
              } catch (error) {
                console.error("❌ Error decrypting message:", error);
                decryptedMessage.decryptedContent = "[Decryption failed]";
              }
            }

            return decryptedMessage;
          })
        );

        setMessages(decryptedMessages as DecryptedMessage[]);
      }
    } catch (error) {
      console.error("💥 Unexpected error in loadMessages:", error);
    }
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newMessage.trim() || !conversationId || isSending) {
      return;
    }

    setIsSending(true);

    const plaintext = newMessage.trim();
    const tempId = `temp-${Date.now()}-${Math.random()}`;

    const optimisticMessage: DecryptedMessage = {
      id: tempId,
      content: "",
      sender_id: currentUserId,
      created_at: new Date().toISOString(),
      profiles: {
        username: "You",
        public_key: undefined,
        pqc_public_key: undefined,
      },
      decryptedContent: plaintext,
      isPending: true,
    };

    setMessages((prev) => [...prev, optimisticMessage]);
    setNewMessage("");

    console.log("✅ Optimistic message added to UI");

    const { data: ownProfile } = await supabase
      .from("profiles")
      .select("public_key, pqc_public_key")
      .eq("id", currentUserId)
      .single();

    if (!ownProfile?.public_key || !ownProfile?.pqc_public_key) {
      console.error("❌ Own public keys not found");
      toast.error("Cannot encrypt message - missing own keys");
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setIsSending(false);
      return;
    }

    if (!recipientPublicKey || !recipientPqcPublicKey) {
      console.error("❌ Recipient's hybrid keys not available");
      toast.error("Recipient's hybrid keys not available");
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setIsSending(false);
      return;
    }

    try {
      console.log("🔐 Encrypting message for recipient...");
      const encryptedForRecipient = await encryptMessage(
        plaintext,
        recipientPublicKey,
        recipientPqcPublicKey
      );
      console.log("✅ Encrypted for recipient");

      console.log("🔐 Encrypting message for yourself...");
      const encryptedForSelf = await encryptMessage(
        plaintext,
        ownProfile.public_key,
        ownProfile.pqc_public_key
      );
      console.log("✅ Encrypted for yourself");

      const contentToSend = JSON.stringify({
        forRecipient: encryptedForRecipient,
        forSender: encryptedForSelf,
      });

      console.log("💾 Inserting message into database...");
      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: currentUserId,
          content: contentToSend,
        })
        .select();

      if (error) {
        console.error("❌ Failed to send message:", error);
        toast.error(`Failed to send message: ${error.message}`);
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setIsSending(false);
        return;
      }

      console.log("✅ Message sent successfully:", data);

      if (data && data[0]) {
        const messageId = data[0].id;
        ownMessagesCache.current.set(messageId, plaintext);
        console.log("💾 Cached plaintext for message:", messageId);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? {
                  ...m,
                  id: messageId,
                  content: data[0].content,
                  created_at: data[0].created_at,
                  isPending: false,
                }
              : m
          )
        );
      }
    } catch (error) {
      console.error("💥 Error sending message:", error);
      toast.error("Failed to send message");
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setIsSending(false);
    }
  };

  if (!conversationId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <MessageSquare className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">Select a conversation</h3>
          <p className="text-muted-foreground">
            Choose a conversation to start quantum-safe messaging
          </p>
        </div>
      </div>
    );
  }

  // ✅ NEW: Check if recipient has encryption keys
  const recipientHasKeys = !!(recipientPublicKey && recipientPqcPublicKey);
  const recipientName = recipientProfile?.username || "User";

  return (
    <div className="flex-1 flex flex-col bg-background">
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-4">
          {messages.map((message) => {
            const isSent = message.sender_id === currentUserId;
            return (
              <div
                key={message.id}
                className={`flex ${isSent ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                    isSent
                      ? "bg-message-sent text-message-sent-foreground rounded-br-sm"
                      : "bg-message-received text-message-received-foreground rounded-bl-sm"
                  } ${message.isPending ? "opacity-70" : ""}`}
                >
                  <p className="break-words">
                    {message.decryptedContent || message.content}
                  </p>
                  <p
                    className={`text-xs mt-1 ${
                      isSent
                        ? "text-message-sent-foreground/70"
                        : "text-message-received-foreground/70"
                    }`}
                  >
                    {message.isPending
                      ? "Sending..."
                      : new Date(message.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* ✅ NEW: Beautiful conditional UI based on recipient's key status */}
      {recipientHasKeys ? (
        <form onSubmit={sendMessage} className="p-4 border-t border-border">
          <div className="flex gap-2">
            <Input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type a quantum-safe message..."
              className="flex-1"
              disabled={isSending}
            />
            <Button type="submit" size="icon" disabled={isSending}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </form>
      ) : (
        <div className="p-4 border-t border-border">
          <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950/30">
            <AlertDescription className="text-amber-700 dark:text-amber-300">
              <div className="flex items-start gap-3">
                <MessageSquare className="h-5 w-5 mt-0.5 flex-shrink-0 text-amber-600" />
                <div className="flex-1 space-y-2">
                  <p className="font-medium text-amber-800 dark:text-amber-200">
                    <strong>{recipientName}</strong> chưa tạo khóa bảo mật
                  </p>
                  <p className="text-sm">
                    Bạn tạm thời không thể trò chuyện với người dùng này. Họ cần
                    đăng nhập lại để tạo khóa mã hóa mới.
                  </p>
                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadRecipientPublicKey}
                      className="h-8 text-xs border-amber-300 hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900"
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Kiểm tra lại
                    </Button>
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      💡 Khóa sẽ tự động cập nhật khi người dùng đăng nhập
                    </p>
                  </div>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  );
};

export default ChatWindow;
