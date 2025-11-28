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
  deriveConversationKeyPair,
  getIdentityPrivateKey,
  getEphemeralPrivateKey,
  type EncryptedMessage 
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
  };
}

interface DecryptedMessage extends Message {
  decryptedContent?: string;
}

const ChatWindow = ({ conversationId, currentUserId }: ChatWindowProps) => {
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [recipientPublicKey, setRecipientPublicKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId) return;

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
          loadMessages();
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
      // Get other participant's public key
      const { data: participants } = await supabase
        .from("conversation_participants")
        .select("user_id, profiles!conversation_participants_user_id_fkey(public_key)")
        .eq("conversation_id", conversationId)
        .neq("user_id", currentUserId);

      if (participants && participants[0]) {
        const profile = participants[0].profiles as any;
        setRecipientPublicKey(profile?.public_key || null);
      }
    } catch (error) {
      console.error("Error loading recipient public key:", error);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadMessages = async () => {
    if (!conversationId) return;

    const { data } = await supabase
      .from("messages")
      .select(`
        id,
        content,
        sender_id,
        created_at,
        profiles!messages_sender_id_fkey(username, public_key)
      `)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (data) {
      // Decrypt messages
      const decryptedMessages = await Promise.all(
        data.map(async (msg: any) => {
          const decryptedMessage = { ...msg } as DecryptedMessage;
          
          // Only decrypt if we're the recipient
          if (msg.sender_id !== currentUserId) {
            try {
              const ephemeralPrivateKey = getEphemeralPrivateKey(conversationId);
              const senderPublicKey = msg.profiles?.public_key;
              
              if (ephemeralPrivateKey && senderPublicKey) {
                // Try to parse as encrypted message
                try {
                  const encryptedData: EncryptedMessage = JSON.parse(msg.content);
                  const decrypted = decryptMessage(
                    encryptedData,
                    senderPublicKey,
                    ephemeralPrivateKey
                  );
                  decryptedMessage.decryptedContent = decrypted || msg.content;
                } catch {
                  // Not encrypted JSON, display as-is
                  decryptedMessage.decryptedContent = msg.content;
                }
              } else {
                decryptedMessage.decryptedContent = msg.content;
              }
            } catch (error) {
              console.error("Error decrypting message:", error);
              decryptedMessage.decryptedContent = "[Encrypted message - unable to decrypt]";
            }
          } else {
            // Our own message, display as-is
            decryptedMessage.decryptedContent = msg.content;
          }
          
          return decryptedMessage;
        })
      );
      
      setMessages(decryptedMessages as DecryptedMessage[]);
    }
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !conversationId) return;

    let contentToSend = newMessage.trim();

    // Encrypt message if recipient's public key is available
    if (recipientPublicKey) {
      try {
        // Get or create ephemeral key for this conversation
        const ephemeralKeyPair = deriveConversationKeyPair(conversationId);
        
        // Encrypt the message
        const encrypted = encryptMessage(
          newMessage.trim(),
          recipientPublicKey,
          ephemeralKeyPair.privateKey
        );
        
        contentToSend = JSON.stringify(encrypted);
      } catch (error) {
        console.error("Encryption error:", error);
        toast.error("Failed to encrypt message");
        return;
      }
    } else {
      toast.error("Recipient's encryption key not available");
      return;
    }

    const { error } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      sender_id: currentUserId,
      content: contentToSend,
    });

    if (error) {
      toast.error("Failed to send message");
      return;
    }

    setNewMessage("");
  };

  if (!conversationId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <MessageSquare className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">Select a conversation</h3>
          <p className="text-muted-foreground">Choose a conversation to start messaging</p>
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
              <div key={message.id} className={`flex ${isSent ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                    isSent
                      ? "bg-message-sent text-message-sent-foreground rounded-br-sm"
                      : "bg-message-received text-message-received-foreground rounded-bl-sm"
                  }`}
                >
                  <p className="break-words">{message.decryptedContent || message.content}</p>
                  <p className={`text-xs mt-1 ${isSent ? "text-message-sent-foreground/70" : "text-message-received-foreground/70"}`}>
                    {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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
            placeholder="Type a message..."
            className="flex-1"
          />
          <Button type="submit" size="icon">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
};

export default ChatWindow;
