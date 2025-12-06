import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, MessageSquare, Lock, Check, CheckCheck } from "lucide-react";
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
  isPending?: boolean;
}

const ChatWindow = ({ conversationId, currentUserId }: ChatWindowProps) => {
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [recipientPublicKey, setRecipientPublicKey] = useState<string | null>(null);
  const [recipientPqcPublicKey, setRecipientPqcPublicKey] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
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
          if (payload.new && payload.new.sender_id !== currentUserId) {
            loadMessages();
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
      const { data: participants, error } = await supabase
        .from("conversation_participants")
        .select(
          "user_id, profiles!conversation_participants_user_id_fkey(public_key, pqc_public_key)"
        )
        .eq("conversation_id", conversationId)
        .neq("user_id", currentUserId);

      if (error) {
        console.error("Error loading recipient keys:", error);
        return;
      }

      if (participants && participants[0]) {
        const profile = participants[0].profiles as any;
        setRecipientPublicKey(profile?.public_key || null);
        setRecipientPqcPublicKey(profile?.pqc_public_key || null);
      }
    } catch (error) {
      console.error("Unexpected error loading recipient keys:", error);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadMessages = async () => {
    if (!conversationId) return;

    try {
      const { data: messagesData, error } = await supabase
        .from("messages")
        .select("id, content, sender_id, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Error loading messages:", error);
        toast.error(`Failed to load messages: ${error.message}`);
        return;
      }

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
        console.error("Error loading profiles:", profileError);
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
                decryptedMessage.decryptedContent = cachedPlaintext;
              } else {
                try {
                  const parsed = JSON.parse(msg.content);

                  if (parsed.forSender) {
                    const identityPrivateKey = getIdentityPrivateKey();
                    const pqcPrivateKey = getPqcPrivateKey();

                    if (identityPrivateKey && pqcPrivateKey) {
                      try {
                        const decrypted = await decryptMessage(
                          parsed.forSender,
                          parsed.forSender.ephemeralPublicKey,
                          pqcPrivateKey,
                          false
                        );
                        decryptedMessage.decryptedContent = decrypted;
                        ownMessagesCache.current.set(msg.id, decrypted);
                      } catch (decryptError) {
                        decryptedMessage.decryptedContent =
                          "[Decryption failed]";
                      }
                    } else {
                      decryptedMessage.decryptedContent = "[Missing keys]";
                    }
                  } else if (parsed.ciphertext) {
                    decryptedMessage.decryptedContent = "[Your encrypted message]";
                  } else {
                    decryptedMessage.decryptedContent = msg.content;
                  }
                } catch (error) {
                  decryptedMessage.decryptedContent = msg.content;
                }
              }
            } else {
              try {
                const identityPrivateKey = getIdentityPrivateKey();
                const pqcPrivateKey = getPqcPrivateKey();

                if (identityPrivateKey && pqcPrivateKey) {
                  try {
                    const parsed = JSON.parse(msg.content);
                    const encryptedData = parsed.forRecipient || parsed;

                    const decrypted = await decryptMessage(
                      encryptedData,
                      encryptedData.ephemeralPublicKey,
                      pqcPrivateKey,
                      false
                    );
                    decryptedMessage.decryptedContent = decrypted;
                  } catch (parseError) {
                    decryptedMessage.decryptedContent = msg.content;
                  }
                } else {
                  decryptedMessage.decryptedContent =
                    "[Missing keys - cannot decrypt]";
                }
              } catch (error) {
                decryptedMessage.decryptedContent = "[Decryption failed]";
              }
            }

            return decryptedMessage;
          })
        );

        setMessages(decryptedMessages as DecryptedMessage[]);
      }
    } catch (error) {
      console.error("Unexpected error in loadMessages:", error);
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

    const { data: ownProfile } = await supabase
      .from("profiles")
      .select("public_key, pqc_public_key")
      .eq("id", currentUserId)
      .single();

    if (!ownProfile?.public_key || !ownProfile?.pqc_public_key) {
      toast.error("Cannot encrypt message - missing own keys");
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setIsSending(false);
      return;
    }

    if (!recipientPublicKey || !recipientPqcPublicKey) {
      toast.error("Recipient's hybrid keys not available");
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setIsSending(false);
      return;
    }

    try {
      const encryptedForRecipient = await encryptMessage(
        plaintext,
        recipientPublicKey,
        recipientPqcPublicKey
      );

      const encryptedForSelf = await encryptMessage(
        plaintext,
        ownProfile.public_key,
        ownProfile.pqc_public_key
      );

      const contentToSend = JSON.stringify({
        forRecipient: encryptedForRecipient,
        forSender: encryptedForSelf,
      });

      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: currentUserId,
          content: contentToSend,
        })
        .select();

      if (error) {
        toast.error(`Failed to send message: ${error.message}`);
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setIsSending(false);
        return;
      }

      if (data && data[0]) {
        const messageId = data[0].id;
        ownMessagesCache.current.set(messageId, plaintext);

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
      toast.error("Failed to send message");
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setIsSending(false);
    }
  };

  if (!conversationId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-background to-primary/5">
        <div className="text-center space-y-4 p-8">
          <div className="relative inline-block">
            <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full animate-pulse" />
            <MessageSquare className="relative h-24 w-24 text-primary mx-auto" />
          </div>
          <h3 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Select a conversation
          </h3>
          <p className="text-muted-foreground max-w-md">
            Choose a conversation to start secure, end-to-end encrypted messaging with post-quantum cryptography
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Lock className="h-4 w-4 text-primary" />
            <span>Protected by ML-KEM-768 + X25519</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gradient-to-br from-background to-primary/5">
      {/* Messages Area */}
      <ScrollArea className="flex-1 p-6" ref={scrollRef}>
        <div className="space-y-4 max-w-4xl mx-auto">
          {messages.map((message, index) => {
            const isSent = message.sender_id === currentUserId;
            const showAvatar = index === 0 || messages[index - 1].sender_id !== message.sender_id;
            
            return (
              <div
                key={message.id}
                className={`flex gap-3 ${isSent ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-2 duration-300`}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                {!isSent && showAvatar && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm font-medium shadow-lg">
                    {message.profiles.username[0]?.toUpperCase() || "?"}
                  </div>
                )}
                
                <div className={`flex flex-col ${isSent ? "items-end" : "items-start"} max-w-[70%]`}>
                  {showAvatar && !isSent && (
                    <span className="text-xs font-medium text-muted-foreground mb-1 px-1">
                      {message.profiles.username}
                    </span>
                  )}
                  
                  <div
                    className={`relative group rounded-2xl px-4 py-3 shadow-md transition-all duration-200 hover:shadow-lg ${
                      isSent
                        ? "bg-gradient-to-br from-primary to-accent text-white rounded-br-sm"
                        : "bg-card border border-border text-foreground rounded-bl-sm"
                    } ${message.isPending ? "opacity-70 scale-95" : "opacity-100 scale-100"}`}
                  >
                    {/* Encryption indicator */}
                    {!message.isPending && (
                      <div className={`absolute -top-1 -right-1 p-1 rounded-full ${isSent ? 'bg-white/20' : 'bg-primary/20'}`}>
                        <Lock className="w-3 h-3" />
                      </div>
                    )}
                    
                    <p className="break-words text-sm leading-relaxed">
                      {message.decryptedContent || message.content}
                    </p>
                    
                    <div className={`flex items-center gap-1 mt-1 text-xs ${
                      isSent ? "text-white/70" : "text-muted-foreground"
                    }`}>
                      <span>
                        {message.isPending
                          ? "Sending..."
                          : new Date(message.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                      </span>
                      {isSent && !message.isPending && (
                        <CheckCheck className="w-3 h-3 ml-1" />
                      )}
                    </div>
                  </div>
                </div>
                
                {isSent && showAvatar && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-sm font-medium shadow-lg">
                    You
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t border-border/50 backdrop-blur-xl bg-card/80 p-4">
        <form onSubmit={sendMessage} className="max-w-4xl mx-auto">
          <div className="flex gap-3 items-end">
            <div className="flex-1 relative">
              <Input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a secure message..."
                className="pr-12 h-12 rounded-2xl border-border/50 bg-background/50 backdrop-blur focus:ring-2 focus:ring-primary/20 transition-all"
                disabled={isSending}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                <Lock className="w-4 h-4" />
              </div>
            </div>
            <Button
              type="submit"
              size="icon"
              disabled={isSending || !newMessage.trim()}
              className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary to-accent hover:shadow-lg transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:scale-100"
            >
              <Send className="h-5 w-5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2 flex items-center justify-center gap-1">
            <Lock className="w-3 h-3" />
            Messages are end-to-end encrypted with hybrid post-quantum cryptography
          </p>
        </form>
      </div>
    </div>
  );
};

export default ChatWindow;