import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MessageSquare, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
  };
  lastMessage?: string;
}

const ConversationList = ({ currentUserId, selectedConversationId, onSelectConversation }: ConversationListProps) => {
  const [conversations, setConversations] = useState<ConversationWithUser[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [searchUsername, setSearchUsername] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    loadConversations();
  }, [currentUserId]);

  const loadConversations = async () => {
    const { data: participants } = await supabase
      .from("conversation_participants")
      .select(`
        conversation_id,
        conversations!inner(id),
        profiles!conversation_participants_user_id_fkey(id, username)
      `)
      .eq("user_id", currentUserId);

    if (participants) {
      const conversationIds = participants.map(p => p.conversation_id);
      
      const { data: allParticipants } = await supabase
        .from("conversation_participants")
        .select("conversation_id, profiles!conversation_participants_user_id_fkey(id, username)")
        .in("conversation_id", conversationIds)
        .neq("user_id", currentUserId);

      const conversationsData: ConversationWithUser[] = participants.map((p: any) => {
        const otherParticipant = allParticipants?.find((ap: any) => ap.conversation_id === p.conversation_id);
        return {
          id: p.conversation_id,
          otherUser: otherParticipant?.profiles || { id: "unknown", username: "Unknown" },
        };
      });

      setConversations(conversationsData);
    }
  };

  const searchUsers = async () => {
    if (!searchUsername.trim()) return;

    const { data } = await supabase
      .from("profiles")
      .select("id, username")
      .ilike("username", `%${searchUsername}%`)
      .neq("id", currentUserId)
      .limit(5);

    setUsers(data || []);
  };

  const startConversation = async (userId: string) => {
    const { data: existingConv } = await supabase
      .from("conversation_participants")
      .select("conversation_id")
      .eq("user_id", currentUserId);

    const conversationIds = existingConv?.map(c => c.conversation_id) || [];

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
      toast.error("Failed to create conversation");
      return;
    }

    const { error: participant1Error } = await supabase
      .from("conversation_participants")
      .insert({ conversation_id: newConv.id, user_id: currentUserId });

    const { error: participant2Error } = await supabase
      .from("conversation_participants")
      .insert({ conversation_id: newConv.id, user_id: userId });

    if (participant1Error || participant2Error) {
      toast.error("Failed to create conversation");
      return;
    }

    loadConversations();
    onSelectConversation(newConv.id);
    setOpen(false);
    toast.success("Conversation started!");
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
                      <AvatarFallback>{user.username[0].toUpperCase()}</AvatarFallback>
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
            <p className="text-sm text-muted-foreground">No conversations yet</p>
            <p className="text-xs text-muted-foreground mt-2">Click + to start chatting</p>
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
                <AvatarFallback>{conv.otherUser.username[0].toUpperCase()}</AvatarFallback>
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
