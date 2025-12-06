import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut, User, Settings, Users } from "lucide-react";
import ConversationList from "@/components/ConversationList";
import ChatWindow from "@/components/ChatWindow";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listUsersWithKeys, hasUserKeys, clearUserKeys } from "@/lib/crypto";

const Index = () => {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [accountsDialogOpen, setAccountsDialogOpen] = useState(false);
  const [editedUsername, setEditedUsername] = useState("");
  const [editedAvatarUrl, setEditedAvatarUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState<string[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const checkUser = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
      } else {
        setUser(session.user);
        loadProfile(session.user.id);
        loadSavedAccounts();
      }
    };
    checkUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        navigate("/auth");
      } else {
        setUser(session.user);
        loadProfile(session.user.id);
        loadSavedAccounts();
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const loadProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("username, avatar_url")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("Error loading profile:", error);
    } else {
      setProfile(data);
      setEditedUsername(data?.username || "");
      setEditedAvatarUrl(data?.avatar_url || "");
    }
  };

  const loadSavedAccounts = () => {
    const accounts = listUsersWithKeys();
    setSavedAccounts(accounts);
    console.log("📋 Saved accounts:", accounts);
  };

  const handleSignOut = async () => {
    // ✅ Ask if user wants to keep keys
    const keepKeys = window.confirm(
      "Do you want to keep encryption keys on this device?\n\n" +
        "• YES - You can decrypt old messages when you log in again on this device\n" +
        "• NO - Keys will be deleted (new keys will be generated on next login, old messages won't be readable)"
    );

    if (!keepKeys && user) {
      clearUserKeys(user.id);
      toast.success(
        "Signed out and cleared encryption keys. New keys will be generated on next login."
      );
    } else {
      toast.success("Signed out (keys kept for this device)");
    }

    await supabase.auth.signOut();
  };

  const handleOpenProfile = () => {
    setEditedUsername(profile?.username || "");
    setEditedAvatarUrl(profile?.avatar_url || "");
    setProfileDialogOpen(true);
  };

  const handleOpenAccounts = () => {
    loadSavedAccounts();
    setAccountsDialogOpen(true);
  };

  const handleSaveProfile = async () => {
    if (!user) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          username: editedUsername,
          avatar_url: editedAvatarUrl,
        })
        .eq("id", user.id);

      if (error) {
        console.error("Error updating profile:", error);
        toast.error("Failed to update profile");
      } else {
        toast.success("Profile updated successfully");
        setProfile({
          username: editedUsername,
          avatar_url: editedAvatarUrl,
        });
        setProfileDialogOpen(false);
      }
    } catch (error) {
      console.error("Unexpected error:", error);
      toast.error("Failed to update profile");
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image size must be less than 2MB");
      return;
    }

    setIsUploading(true);
    try {
      if (profile?.avatar_url && profile.avatar_url.includes("supabase")) {
        const oldPath = profile.avatar_url.split("/avatars/")[1];
        if (oldPath) {
          await supabase.storage.from("avatars").remove([oldPath]);
        }
      }

      const fileExt = file.name.split(".").pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(fileName, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        toast.error("Failed to upload avatar");
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(uploadData.path);

      setEditedAvatarUrl(publicUrl);
      toast.success("Avatar uploaded successfully");
    } catch (error) {
      console.error("Unexpected upload error:", error);
      toast.error("Failed to upload avatar");
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveAccount = async (userId: string) => {
    const confirm = window.confirm(
      "Are you sure you want to remove encryption keys for this account?\n\n" +
        "⚠️ This will delete all local keys.\n" +
        "• Old messages from this account on this device won't be decryptable\n" +
        "• New keys will be generated automatically on next login\n" +
        "• You can continue using the account normally with new keys"
    );

    if (confirm) {
      clearUserKeys(userId);
      loadSavedAccounts();
      toast.success(
        "Account keys removed. New keys will be generated on next login."
      );
    }
  };

  if (!user) return null;

  return (
    <div className="h-screen flex flex-col">
      <header className="bg-card border-b border-border px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-primary">ChatApp</h1>

        <div className="flex items-center gap-2">
          {/* ✅ NEW: Show saved accounts indicator */}
          {savedAccounts.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenAccounts}
              className="text-xs"
            >
              <Users className="h-4 w-4 mr-1" />
              {savedAccounts.length} accounts
            </Button>
          )}

          {/* Profile Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="flex items-center gap-2 h-auto py-2"
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage
                    src={profile?.avatar_url}
                    alt={profile?.username}
                  />
                  <AvatarFallback>
                    {profile?.username?.[0]?.toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden md:inline-block font-medium">
                  {profile?.username || "User"}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleOpenProfile}>
                <Settings className="mr-2 h-4 w-4" />
                <span>Edit Profile</span>
              </DropdownMenuItem>
              {savedAccounts.length > 1 && (
                <DropdownMenuItem onClick={handleOpenAccounts}>
                  <Users className="mr-2 h-4 w-4" />
                  <span>Manage Accounts ({savedAccounts.length})</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>Sign Out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <ConversationList
          currentUserId={user.id}
          selectedConversationId={selectedConversationId}
          onSelectConversation={setSelectedConversationId}
        />
        <ChatWindow
          conversationId={selectedConversationId}
          currentUserId={user.id}
        />
      </div>

      {/* Profile Edit Dialog */}
      <Dialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>
              Update your profile information here.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex flex-col items-center gap-2">
              <Avatar className="h-24 w-24">
                <AvatarImage src={editedAvatarUrl} alt={editedUsername} />
                <AvatarFallback className="text-2xl">
                  {editedUsername?.[0]?.toUpperCase() || "U"}
                </AvatarFallback>
              </Avatar>

              <Label htmlFor="avatar-upload" className="cursor-pointer">
                <div className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors">
                  {isUploading ? "Uploading..." : "Upload Photo"}
                </div>
                <Input
                  id="avatar-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  disabled={isUploading}
                  className="hidden"
                />
              </Label>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={editedUsername}
                onChange={(e) => setEditedUsername(e.target.value)}
                placeholder="Enter username"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setProfileDialogOpen(false)}
              disabled={isSaving || isUploading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveProfile}
              disabled={isSaving || isUploading}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ✅ NEW: Accounts Management Dialog */}
      <Dialog open={accountsDialogOpen} onOpenChange={setAccountsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Saved Accounts on This Device</DialogTitle>
            <DialogDescription>
              Accounts with encryption keys stored locally. You can decrypt
              messages from these accounts on this device.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4 max-h-96 overflow-y-auto">
            {savedAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No saved accounts found
              </p>
            ) : (
              savedAccounts.map((userId) => (
                <div
                  key={userId}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback>
                        {userId.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">
                        {userId === user?.id
                          ? "Current Account"
                          : "Saved Account"}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {userId.substring(0, 8)}...
                      </p>
                    </div>
                  </div>
                  {userId !== user?.id && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleRemoveAccount(userId)}
                    >
                      Remove Keys
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="flex justify-end">
            <Button onClick={() => setAccountsDialogOpen(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
