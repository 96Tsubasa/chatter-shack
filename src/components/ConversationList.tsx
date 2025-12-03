import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
  }, [currentUserId]);

  const loadConversations = async () => {
    // Bước 1: Lấy tất cả cuộc trò chuyện mà mình tham gia
    const { data: myParticipants, error: err1 } = await supabase
      .from("conversation_participants")
      .select("conversation_id")
      .eq("user_id", currentUserId);

    if (err1 || !myParticipants || myParticipants.length === 0) {
      setConversations([]);
      return;
    }

    const conversationIds = myParticipants.map((p) => p.conversation_id);

    // Bước 2: Lấy người còn lại trong từng cuộc trò chuyện (chỉ cần 1 query duy nhất)
    const { data: otherParticipants, error: err2 } = await supabase
      .from("conversation_participants")
      .select(
        `
      conversation_id,
      profiles (
        id,
        username,
        avatar_url
      )
    `
      )
      .in("conversation_id", conversationIds)
      .neq("user_id", currentUserId);

    if (err2) {
      console.error("Lỗi load người còn lại:", err2);
      setConversations([]);
      return;
    }

    // Bước 3: Tạo danh sách hiển thị – không còn lỗi TypeScript nào
    const conversationsData: ConversationWithUser[] = myParticipants.map(
      (p) => {
        const participant = otherParticipants.find(
          (x) => x.conversation_id === p.conversation_id
        );

        // participant.profiles luôn có kiểu đúng sau khi gen types mới
        const profile = participant?.profiles as {
          id: string;
          username: string | null;
          avatar_url: string | null;
        };

        return {
          id: p.conversation_id,
          otherUser: profile
            ? {
                id: profile.id,
                username: profile.username || "Người dùng",
                avatar_url: profile.avatar_url,
              }
            : {
                id: "unknown",
                username: "Đã xóa",
                avatar_url: null,
              },
        };
      }
    );

    setConversations(conversationsData);
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
    // Basic guards
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

      const conversationIds =
        existingConv?.map((c: any) => c.conversation_id) || [];

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

      // Success
      await loadConversations();
      onSelectConversation(newConv.id);
      setOpen(false);
      toast.success("Conversation started!");
    } catch (err) {
      console.error("Unexpected error in startConversation:", err);
      toast.error(
        "Unexpected error starting conversation. Check console for details."
      );
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
                      <AvatarFallback>
                        {user.username[0].toUpperCase()}
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
                <AvatarFallback>
                  {conv.otherUser.username[0].toUpperCase()}
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
