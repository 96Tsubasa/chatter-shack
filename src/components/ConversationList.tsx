import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MessageSquare, Plus, Search, Users } from "lucide-react";
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
    avatar_url?: string;
  };
  lastMessage?: string;
}

const ConversationList = ({
  currentUserId,
  selectedConversationId,
  onSelectConversation,
}: ConversationListProps) => {
  const [conversations, setConversations] = useState<ConversationWithUser[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [searchUsername, setSearchUsername] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    loadConversations();

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
          loadConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  const loadConversations = async () => {
    try {
      const { data: myParticipants, error: err1 } = await supabase
        .from("conversation_participants")
        .select("conversation_id")
        .eq("user_id", currentUserId);

      if (err1 || !myParticipants || myParticipants.length === 0) {
        setConversations([]);
        return;
      }

      const conversationIds = myParticipants.map((p) => p.conversation_id);

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

      const conversationsData: ConversationWithUser[] = myParticipants.map((p) => {
        const participant = otherParticipants?.find(
          (x) => x.conversation_id === p.conversation_id
        );

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
      });

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
    <div className="w-full md:w-96 border-r border-border/50 bg-card/50 backdrop-blur-xl flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border/50 bg-gradient-to-br from-card to-primary/5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h2 className="font-bold text-lg">Conversations</h2>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button
                size="icon"
                className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary to-accent hover:shadow-lg transition-all duration-200 hover:scale-105"
              >
                <Plus className="h-5 w-5" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle className="text-xl flex items-center gap-2">
                  <Search className="h-5 w-5 text-primary" />
                  Start a conversation
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search username..."
                      value={searchUsername}
                      onChange={(e) => setSearchUsername(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && searchUsers()}
                      className="pl-10 h-11"
                    />
                  </div>
                  <Button
                    onClick={searchUsers}
                    className="bg-gradient-to-r from-primary to-accent hover:shadow-lg transition-all"
                  >
                    Search
                  </Button>
                </div>
                
                <ScrollArea className="h-80">
                  {users.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-8">
                      <Users className="h-12 w-12 text-muted-foreground mb-3" />
                      <p className="text-sm text-muted-foreground">
                        Search for users to start chatting
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {users.map((user) => (
                        <button
                          key={user.id}
                          onClick={() => startConversation(user.id)}
                          className="w-full p-4 hover:bg-primary/5 rounded-xl flex items-center gap-3 transition-all duration-200 group border border-transparent hover:border-primary/20"
                        >
                          <Avatar className="h-12 w-12 ring-2 ring-transparent group-hover:ring-primary/20 transition-all">
                            <AvatarImage src={user.avatar_url} alt={user.username} />
                            <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-white">
                              {user.username?.[0]?.toUpperCase() || "?"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 text-left">
                            <p className="font-semibold">{user.username}</p>
                            <p className="text-xs text-muted-foreground">
                              Click to start chatting
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Conversations List */}
      <ScrollArea className="flex-1">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <div className="relative mb-4">
              <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full animate-pulse" />
              <MessageSquare className="relative h-16 w-16 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">
              No conversations yet
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              Click the + button to start chatting
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className={`w-full p-4 rounded-xl transition-all duration-200 flex items-center gap-3 group ${
                  selectedConversationId === conv.id
                    ? "bg-gradient-to-r from-primary/10 to-accent/10 shadow-md border-2 border-primary/20"
                    : "hover:bg-primary/5 border-2 border-transparent"
                }`}
              >
                <div className="relative">
                  <Avatar className={`h-12 w-12 ring-2 transition-all ${
                    selectedConversationId === conv.id
                      ? "ring-primary/30"
                      : "ring-transparent group-hover:ring-primary/10"
                  }`}>
                    <AvatarImage
                      src={conv.otherUser.avatar_url}
                      alt={conv.otherUser.username}
                    />
                    <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-white font-semibold">
                      {conv.otherUser.username[0]?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  {/* Online indicator */}
                  <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-card" />
                </div>
                
                <div className="flex-1 text-left min-w-0">
                  <p className={`font-semibold truncate ${
                    selectedConversationId === conv.id
                      ? "text-primary"
                      : "text-foreground"
                  }`}>
                    {conv.otherUser.username}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    Tap to open conversation
                  </p>
                </div>

                {selectedConversationId === conv.id && (
                  <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                )}
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

export default ConversationList;