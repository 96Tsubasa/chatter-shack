import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, MessageSquare } from "lucide-react";
import { toast } from "sonner";
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
  const [isSending, setIsSending] = useState(false); // ✅ Prevent spam
  const scrollRef = useRef<HTMLDivElement>(null);

  // ✅ NEW: Local cache for own messages plaintext
  const ownMessagesCache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!conversationId) return;

    // ✅ Clear cache when switching conversations
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

          // ✅ Only reload if message is from OTHERS, not yourself
          if (payload.new && payload.new.sender_id !== currentUserId) {
            console.log("🔄 Reloading messages (from other user)");
            loadMessages();
          } else {
            console.log(
              "⏭️ Skipping reload (own message already added optimistically)"
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

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
      // Query 1: Load messages without JOIN
      const { data: messagesData, error } = await supabase
        .from("messages")
        .select("id, content, sender_id, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("❌ Error loading messages:", error);
        console.error("Error details:", {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        });
        toast.error(`Failed to load messages: ${error.message}`);
        return;
      }

      console.log(`✅ Loaded ${messagesData?.length || 0} messages`);

      if (!messagesData || messagesData.length === 0) {
        setMessages([]);
        return;
      }

      // Query 2: Load sender profiles separately
      const senderIds = [...new Set(messagesData.map((m) => m.sender_id))];
      const { data: profilesData, error: profileError } = await supabase
        .from("profiles")
        .select("id, username, public_key, pqc_public_key")
        .in("id", senderIds);

      if (profileError) {
        console.error("❌ Error loading profiles:", profileError);
      }

      // Query 3: Combine data
      const data = messagesData.map((msg) => ({
        ...msg,
        profiles: profilesData?.find((p) => p.id === msg.sender_id) || {
          username: "Unknown",
          public_key: null,
          pqc_public_key: null,
        },
      }));

      if (error) {
        console.error("❌ Error loading messages:", error);
        console.error("Error details:", {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        });
        toast.error(`Failed to load messages: ${error.message}`);
        return;
      }

      if (data) {
        const decryptedMessages = await Promise.all(
          data.map(async (msg: any) => {
            const decryptedMessage = { ...msg } as DecryptedMessage;

            // Check if own message
            const isOwnMessage = msg.sender_id === currentUserId;

            if (isOwnMessage) {
              // ✅ Check local cache first
              const cachedPlaintext = ownMessagesCache.current.get(msg.id);
              if (cachedPlaintext) {
                console.log("✅ Using cached plaintext for message:", msg.id);
                decryptedMessage.decryptedContent = cachedPlaintext;
              } else {
                // No cache - try to decrypt forSender version
                try {
                  const parsed = JSON.parse(msg.content);

                  if (parsed.forSender) {
                    // ✅ NEW FORMAT: Decrypt forSender
                    console.log("🔓 Decrypting own message from forSender...");
                    const identityPrivateKey = getIdentityPrivateKey();
                    const pqcPrivateKey = getPqcPrivateKey();

                    if (identityPrivateKey && pqcPrivateKey) {
                      const decrypted = await decryptMessage(
                        parsed.forSender,
                        parsed.forSender.ephemeralPublicKey,
                        pqcPrivateKey
                      );
                      decryptedMessage.decryptedContent = decrypted;
                      // Cache it for future renders
                      ownMessagesCache.current.set(msg.id, decrypted);
                      console.log("✅ Decrypted and cached own message");
                    } else {
                      decryptedMessage.decryptedContent = "[Missing keys]";
                    }
                  } else if (parsed.ciphertext) {
                    // OLD FORMAT: Just encrypted for recipient
                    decryptedMessage.decryptedContent =
                      "[Your encrypted message]";
                  } else {
                    decryptedMessage.decryptedContent = msg.content;
                  }
                } catch (error) {
                  console.error("❌ Error parsing own message:", error);
                  // Plain text message
                  decryptedMessage.decryptedContent = msg.content;
                }
              }
            } else {
              // ✅ Other's message: Decrypt it
              try {
                const identityPrivateKey = getIdentityPrivateKey();
                const pqcPrivateKey = getPqcPrivateKey();

                if (identityPrivateKey && pqcPrivateKey) {
                  try {
                    const parsed = JSON.parse(msg.content);

                    // ✅ Check for new format (forRecipient/forSender)
                    const encryptedData = parsed.forRecipient || parsed;

                    console.log(
                      "🔓 Attempting to decrypt message from:",
                      msg.profiles?.username
                    );

                    const decrypted = await decryptMessage(
                      encryptedData,
                      encryptedData.ephemeralPublicKey,
                      pqcPrivateKey
                    );
                    decryptedMessage.decryptedContent = decrypted;
                    console.log("✅ Decryption successful");
                  } catch (parseError) {
                    console.warn(
                      "⚠️ Could not parse as encrypted, showing plaintext"
                    );
                    decryptedMessage.decryptedContent = msg.content;
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

    // ✅ FIX BUG #1: Prevent spam sending
    if (!newMessage.trim() || !conversationId || isSending) {
      console.log("⏭️ Skipping send:", {
        hasMessage: !!newMessage.trim(),
        hasConversation: !!conversationId,
        isSending,
      });
      return;
    }

    setIsSending(true); // Lock sending

    console.log("📤 Attempting to send message...");
    const plaintext = newMessage.trim();
    console.log("Message text:", plaintext);
    console.log("Conversation ID:", conversationId);
    console.log("Current user ID:", currentUserId);
    console.log("Has recipient classical key:", !!recipientPublicKey);
    console.log("Has recipient PQC key:", !!recipientPqcPublicKey);

    // ✅ Get own public keys for self-encryption
    const { data: ownProfile } = await supabase
      .from("profiles")
      .select("public_key, pqc_public_key")
      .eq("id", currentUserId)
      .single();

    if (!ownProfile?.public_key || !ownProfile?.pqc_public_key) {
      console.error("❌ Own public keys not found");
      toast.error("Cannot encrypt message - missing own keys");
      setIsSending(false);
      return;
    }

    if (!recipientPublicKey || !recipientPqcPublicKey) {
      console.error("❌ Recipient's hybrid keys not available");
      toast.error("Recipient's hybrid keys not available");
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

      // ✅ Store both encrypted versions
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
        console.error("Error details:", {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        });
        toast.error(`Failed to send message: ${error.message}`);
        setIsSending(false);
        return;
      }

      console.log("✅ Message sent successfully:", data);

      // ✅ Optimistically add own message to UI with plaintext
      if (data && data[0]) {
        const messageId = data[0].id;

        // ✅ Cache plaintext for this message
        ownMessagesCache.current.set(messageId, plaintext);
        console.log("💾 Cached plaintext for message:", messageId);

        const newMsg: DecryptedMessage = {
          id: messageId,
          content: data[0].content,
          sender_id: data[0].sender_id,
          created_at: data[0].created_at,
          profiles: {
            username: "You",
            public_key: undefined,
            pqc_public_key: undefined,
          },
          decryptedContent: plaintext,
        };

        setMessages((prev) => {
          const exists = prev.some((m) => m.id === newMsg.id);
          if (exists) {
            console.log("⚠️ Message already in list, skipping duplicate");
            return prev;
          }
          return [...prev, newMsg];
        });
      }

      setNewMessage("");
    } catch (error) {
      console.error("💥 Error sending message:", error);
      toast.error("Failed to send message");
    } finally {
      setIsSending(false); // Unlock sending
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
                  }`}
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
                    {new Date(message.created_at).toLocaleTimeString([], {
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
      <form onSubmit={sendMessage} className="p-4 border-t border-border">
        <div className="flex gap-2">
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a quantum-safe message..."
            className="flex-1"
          />
          <Button type="submit" size="icon" disabled={isSending}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
};

export default ChatWindow;
