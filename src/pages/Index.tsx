import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import ConversationList from "@/components/ConversationList";
import ChatWindow from "@/components/ChatWindow";
import { toast } from "sonner";
import { clearAllKeys } from "@/lib/crypto";

const Index = () => {
  const [user, setUser] = useState<any>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
      } else {
        setUser(session.user);
      }
    };
    checkUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        navigate("/auth");
      } else {
        setUser(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleSignOut = async () => {
    clearAllKeys(); // Clear encryption keys for security
    await supabase.auth.signOut();
    toast.success("Signed out successfully");
  };

  if (!user) return null;

  return (
    <div className="h-screen flex flex-col">
      <header className="bg-card border-b border-border px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-primary">ChatApp</h1>
        <Button variant="ghost" size="icon" onClick={handleSignOut}>
          <LogOut className="h-5 w-5" />
        </Button>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <ConversationList
          currentUserId={user.id}
          selectedConversationId={selectedConversationId}
          onSelectConversation={setSelectedConversationId}
        />
        <ChatWindow conversationId={selectedConversationId} currentUserId={user.id} />
      </div>
    </div>
  );
};

export default Index;
