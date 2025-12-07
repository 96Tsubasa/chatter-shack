import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut, Settings, Users, AlertCircle, Trash2 } from "lucide-react";
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
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

// ✅ NEW: Interface for saved account with profile info
interface SavedAccount {
  userId: string;
  username: string;
  avatarUrl: string | null;
}

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
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]); // ✅ Updated type
  const [removeKeyDialog, setRemoveKeyDialog] = useState<{
    open: boolean;
    userId: string | null;
    username: string | null; // ✅ NEW: Store username for better UX
    isCurrentUser: boolean;
  }>({
    open: false,
    userId: null,
    username: null,
    isCurrentUser: false,
  });
  const [signOutDialog, setSignOutDialog] = useState<{
    open: boolean;
    keepKeys: boolean | null;
  }>({
    open: false,
    keepKeys: null,
  });
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

  // ✅ UPDATED: Load saved accounts with profile information
  const loadSavedAccounts = async () => {
    const userIds = listUsersWithKeys();

    if (userIds.length === 0) {
      setSavedAccounts([]);
      return;
    }

    try {
      // Fetch profile data for all saved user IDs
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, username, avatar_url")
        .in("id", userIds);

      if (error) {
        console.error("Error loading profiles for saved accounts:", error);
        // Fallback to showing userId if profile fetch fails
        setSavedAccounts(
          userIds.map((userId) => ({
            userId,
            username: userId.substring(0, 8) + "...",
            avatarUrl: null,
          }))
        );
        return;
      }

      // Map profiles to saved accounts
      const accountsWithProfiles = userIds.map((userId) => {
        const profile = profiles?.find((p) => p.id === userId);
        return {
          userId,
          username: profile?.username || `User ${userId.substring(0, 8)}`,
          avatarUrl: profile?.avatar_url || null,
        };
      });

      setSavedAccounts(accountsWithProfiles);
    } catch (error) {
      console.error("Unexpected error loading saved accounts:", error);
      setSavedAccounts([]);
    }
  };

  const openSignOutDialog = () => {
    setSignOutDialog({ open: true, keepKeys: null });
  };

  const handleSignOut = async () => {
    openSignOutDialog();
  };

  const confirmSignOut = async () => {
    const keepKeys = signOutDialog.keepKeys === true;

    if (!keepKeys && user) {
      clearUserKeys(user.id);

      const { error } = await supabase
        .from("profiles")
        .update({
          public_key: null,
          pqc_public_key: null,
        })
        .eq("id", user.id);

      if (error) {
        console.error("Lỗi xóa public key:", error);
        toast.error("Không thể xóa khóa trên server");
      } else {
        toast.success("Đã đăng xuất và xóa toàn bộ khóa mã hóa");
      }
    } else {
      toast.success(
        "Đăng xuất thành công (khóa được giữ lại trên thiết bị này)"
      );
    }

    setSignOutDialog({ open: false, keepKeys: null });
    await supabase.auth.signOut();
  };

  const handleOpenProfile = () => {
    setEditedUsername(profile?.username || "");
    setEditedAvatarUrl(profile?.avatar_url || "");
    setProfileDialogOpen(true);
  };

  const handleOpenAccounts = () => {
    loadSavedAccounts(); // Refresh accounts when opening dialog
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
        // Refresh saved accounts to update current user's display
        loadSavedAccounts();
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

  const openRemoveKeyDialog = (userId: string, username: string) => {
    setRemoveKeyDialog({
      open: true,
      userId,
      username, // ✅ Store username for display
      isCurrentUser: userId === user?.id,
    });
  };

  const confirmRemoveKeys = async () => {
    if (!removeKeyDialog.userId) return;

    const userIdToRemove = removeKeyDialog.userId;

    clearUserKeys(userIdToRemove);

    const { error } = await supabase
      .from("profiles")
      .update({
        public_key: null,
        pqc_public_key: null,
      })
      .eq("id", userIdToRemove);

    if (error) {
      console.error("Lỗi xóa public key:", error);
      toast.error("Không thể xóa khóa trên server");
    } else {
      toast.success("Đã xóa khóa mã hóa thành công");
    }

    loadSavedAccounts();
    setRemoveKeyDialog({
      open: false,
      userId: null,
      username: null,
      isCurrentUser: false,
    });
  };

  if (!user) return null;

  return (
    <div className="h-screen flex flex-col">
      <header className="bg-card border-b border-border px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-primary">ChatApp</h1>

        <div className="flex items-center gap-2">
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

      {/* ✅ UPDATED: Accounts Management Dialog with Profile Display */}
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
              savedAccounts.map((account) => (
                <div
                  key={account.userId}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage
                        src={account.avatarUrl || undefined}
                        alt={account.username}
                      />
                      <AvatarFallback>
                        {account.username[0]?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">
                        {account.username}
                        {account.userId === user?.id && (
                          <span className="ml-2 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950 px-2 py-0.5 rounded-full">
                            Current
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        ID: {account.userId.substring(0, 12)}...
                      </p>
                    </div>
                  </div>
                  {account.userId !== user?.id && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        openRemoveKeyDialog(account.userId, account.username)
                      }
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Remove
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

      {/* ✅ UPDATED: Remove Key Dialog with Username */}
      <Dialog
        open={removeKeyDialog.open}
        onOpenChange={(open) =>
          !open &&
          setRemoveKeyDialog({
            open: false,
            userId: null,
            username: null,
            isCurrentUser: false,
          })
        }
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              Xóa khóa mã hóa
            </DialogTitle>
            <DialogDescription>
              Hành động này <strong>không thể hoàn tác</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Cảnh báo</AlertTitle>
              <AlertDescription className="space-y-2 text-sm">
                <p>
                  • Tất cả tin nhắn cũ của tài khoản này sẽ{" "}
                  <strong>không thể giải mã</strong>
                </p>
                <p>
                  • Người khác sẽ <strong>không thể gửi tin nhắn</strong> cho
                  tài khoản này
                </p>
                <p>• Khóa mới sẽ được tạo lại khi đăng nhập lần sau</p>
              </AlertDescription>
            </Alert>

            <div className="text-sm text-muted-foreground">
              Bạn đang xóa khóa của tài khoản:
              <div className="mt-2 p-3 bg-secondary rounded-lg">
                <p className="font-semibold text-foreground">
                  {removeKeyDialog.username || "Unknown User"}
                </p>
                <p className="text-xs font-mono text-muted-foreground mt-1">
                  {removeKeyDialog.userId?.substring(0, 12)}...
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() =>
                setRemoveKeyDialog({
                  open: false,
                  userId: null,
                  username: null,
                  isCurrentUser: false,
                })
              }
            >
              Hủy
            </Button>
            <Button variant="destructive" onClick={confirmRemoveKeys}>
              <Trash2 className="h-4 w-4 mr-2" />
              Xóa khóa vĩnh viễn
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sign Out Confirmation Dialog */}
      <Dialog
        open={signOutDialog.open}
        onOpenChange={(open) =>
          !open && setSignOutDialog({ open: false, keepKeys: null })
        }
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="h-5 w-5" />
              Đăng xuất
            </DialogTitle>
            <DialogDescription>
              Bạn có muốn giữ lại khóa mã hóa trên thiết bị này không?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() =>
                  setSignOutDialog((prev) => ({ ...prev, keepKeys: true }))
                }
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  signOutDialog.keepKeys === true
                    ? "border-green-500 bg-green-50 dark:bg-green-950/30"
                    : "border-border hover:border-green-400"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                    Keep
                  </div>
                  <div>
                    <p className="font-semibold text-green-700 dark:text-green-300">
                      Giữ khóa
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Bạn vẫn có thể đọc lại tin nhắn cũ khi đăng nhập lại trên
                      thiết bị này
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() =>
                  setSignOutDialog((prev) => ({ ...prev, keepKeys: false }))
                }
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  signOutDialog.keepKeys === false
                    ? "border-red-500 bg-red-50 dark:bg-red-950/30"
                    : "border-border hover:border-red-400"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center">
                    Delete
                  </div>
                  <div>
                    <p className="font-semibold text-red-700 dark:text-red-300">
                      Xóa khóa
                    </p>
                    <p className="text-sm text-red-500 text-muted-foreground">
                      Khóa sẽ bị xóa hoàn toàn. Bạn sẽ không thể đọc tin nhắn cũ
                      nữa. Người khác không thể gửi tin nhắn cho bạn cho đến khi
                      bạn đăng nhập lại.
                    </p>
                  </div>
                </div>
              </button>
            </div>

            {signOutDialog.keepKeys !== null && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Bạn đã chọn:</AlertTitle>
                <AlertDescription>
                  {signOutDialog.keepKeys === true
                    ? "Khóa mã hóa sẽ được giữ lại trên thiết bị này"
                    : "Tất cả khóa mã hóa sẽ bị xóa vĩnh viễn khỏi thiết bị và server"}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => setSignOutDialog({ open: false, keepKeys: null })}
            >
              Hủy
            </Button>
            <Button
              variant="default"
              disabled={signOutDialog.keepKeys === null}
              onClick={confirmSignOut}
            >
              Đăng xuất
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
