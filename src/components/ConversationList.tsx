import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MessageSquare, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface ConversationListProps {
  currentUserId: string;
  selectedConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
}

interface ConversationWithUser {
  id: string;
  otherUser: {
    id: string;
    username: string;
    avatar_url?: string; // ✅ Add avatar
  };
  lastMessage?: string;
}

const ConversationList = ({
  currentUserId,
  selectedConversationId,
  onSelectConversation,
}: ConversationListProps) => {
  const [conversations, setConversations] = useState<ConversationWithUser[]>(
    []
  );
  const [users, setUsers] = useState<any[]>([]);
  const [searchUsername, setSearchUsername] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    loadConversations();

    // ✅ FIX BUG #2: Subscribe to new conversations
    const channel = supabase
      .channel("conversation-changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversation_participants",
          filter: `user_id=eq.${currentUserId}`,
        },
        (payload) => {
          console.log("📨 New conversation participant added:", payload);
          loadConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  // ✅ FIXED: Sau khi có relationship trong types.ts, có thể dùng JOIN
  const loadConversations = async () => {
    try {
      // Step 1: Lấy conversation IDs của mình
      const { data: myParticipants, error: err1 } = await supabase
        .from("conversation_participants")
        .select("conversation_id")
        .eq("user_id", currentUserId);

      if (err1 || !myParticipants || myParticipants.length === 0) {
        setConversations([]);
        return;
      }

      const conversationIds = myParticipants.map((p) => p.conversation_id);

      // Step 2: JOIN query với profiles (giờ đã có relationship)
      const { data: otherParticipants, error: err2 } = await supabase
        .from("conversation_participants")
        .select(
          `
          conversation_id,
          profiles!conversation_participants_user_id_fkey (
            id,
            username,
            avatar_url
          )
        `
        )
        .in("conversation_id", conversationIds)
        .neq("user_id", currentUserId);

      if (err2) {
        console.error("Error loading conversations:", err2);
        setConversations([]);
        return;
      }

      // Step 3: Map dữ liệu
      const conversationsData: ConversationWithUser[] = myParticipants.map(
        (p) => {
          const participant = otherParticipants?.find(
            (x) => x.conversation_id === p.conversation_id
          );

          // ✅ TypeScript giờ biết profiles có đúng type
          const profile = participant?.profiles as {
            id: string;
            username: string | null;
            avatar_url: string | null;
          } | null;

          return {
            id: p.conversation_id,
            otherUser: {
              id: profile?.id || "unknown",
              username: profile?.username || "Unknown User",
              avatar_url: profile?.avatar_url || undefined,
            },
          };
        }
      );

      setConversations(conversationsData);
    } catch (error) {
      console.error("Unexpected error in loadConversations:", error);
      setConversations([]);
    }
  };

  const searchUsers = async () => {
    if (!searchUsername.trim()) return;

    const { data } = await supabase
      .from("profiles")
      .select("id, username, avatar_url")
      .ilike("username", `%${searchUsername}%`)
      .neq("id", currentUserId)
      .limit(5);

    setUsers(data || []);
  };

  const startConversation = async (userId: string) => {
    if (!currentUserId) {
      toast.error("Not authenticated. Please sign in.");
      return;
    }

    if (userId === currentUserId) {
      toast.error("Cannot start a conversation with yourself.");
      return;
    }

    try {
      const { data: existingConv } = await supabase
        .from("conversation_participants")
        .select("conversation_id")
        .eq("user_id", currentUserId);

      const conversationIds = existingConv?.map((c) => c.conversation_id) || [];

      if (conversationIds.length > 0) {
        const { data: otherParticipants } = await supabase
          .from("conversation_participants")
          .select("conversation_id")
          .eq("user_id", userId)
          .in("conversation_id", conversationIds);

        if (otherParticipants && otherParticipants.length > 0) {
          onSelectConversation(otherParticipants[0].conversation_id);
          setOpen(false);
          return;
        }
      }

      const { data: newConv, error: convError } = await supabase
        .from("conversations")
        .insert({})
        .select()
        .single();

      if (convError || !newConv) {
        console.error("Error creating conversation:", convError);
        toast.error(convError?.message ?? "Failed to create conversation");
        return;
      }

      const { error: participant1Error } = await supabase
        .from("conversation_participants")
        .insert({ conversation_id: newConv.id, user_id: currentUserId });

      if (participant1Error) {
        console.error("Error inserting participant 1:", participant1Error);
        toast.error(participant1Error.message ?? "Failed to add participant");
        return;
      }

      const { error: participant2Error } = await supabase
        .from("conversation_participants")
        .insert({ conversation_id: newConv.id, user_id: userId });

      if (participant2Error) {
        console.error("Error inserting participant 2:", participant2Error);
        toast.error(participant2Error.message ?? "Failed to add participant");
        return;
      }

      await loadConversations();
      onSelectConversation(newConv.id);
      setOpen(false);
      toast.success("Conversation started!");
    } catch (err) {
      console.error("Unexpected error in startConversation:", err);
      toast.error("Unexpected error starting conversation.");
    }
  };

  return (
    <div className="w-full md:w-80 border-r border-border bg-card flex flex-col">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold text-lg">Messages</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="icon" variant="ghost">
              <Plus className="h-5 w-5" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Start a conversation</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Search username..."
                  value={searchUsername}
                  onChange={(e) => setSearchUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchUsers()}
                />
                <Button onClick={searchUsers}>Search</Button>
              </div>
              <ScrollArea className="h-64">
                {users.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => startConversation(user.id)}
                    className="w-full p-3 hover:bg-secondary rounded-lg flex items-center gap-3 transition-colors"
                  >
                    <Avatar>
                      <AvatarImage src={user.avatar_url} alt={user.username} />
                      <AvatarFallback>
                        {user.username?.[0]?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium">{user.username}</span>
                  </button>
                ))}
              </ScrollArea>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <ScrollArea className="flex-1">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-sm text-muted-foreground">
              No conversations yet
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Click + to start chatting
            </p>
          </div>
        ) : (
          conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => onSelectConversation(conv.id)}
              className={`w-full p-4 hover:bg-secondary transition-colors flex items-center gap-3 border-b border-border ${
                selectedConversationId === conv.id ? "bg-secondary" : ""
              }`}
            >
              <Avatar>
                <AvatarImage
                  src={conv.otherUser.avatar_url}
                  alt={conv.otherUser.username}
                />
                <AvatarFallback>
                  {conv.otherUser.username[0]?.toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 text-left">
                <p className="font-medium">{conv.otherUser.username}</p>
              </div>
            </button>
          ))
        )}
      </ScrollArea>
    </div>
  );
};

export default ConversationList;
