import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";
import naclUtil from "tweetnacl-util";
import {
  generateHybridKeyPair,
  storeHybridPrivateKeys,
  getIdentityPrivateKey,
  getPqcPrivateKey,
} from "@/lib/crypto";

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const checkUser = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        navigate("/");
      }
    };
    checkUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        navigate("/");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        console.log("🔐 Attempting login...");
        const { error, data } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          console.error("❌ Login error:", error);
          throw error;
        }

        console.log("✅ Login successful, checking keys...");

        // ✅ CRITICAL FIX: Fetch keys from database first
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("public_key, pqc_public_key")
          .eq("id", data.user.id)
          .single();

        if (profileError) {
          console.error("❌ Error fetching profile:", profileError);
          throw profileError;
        }

        // Check local keys
        let classicalPriv = getIdentityPrivateKey();
        let pqcPriv = getPqcPrivateKey();

        // ✅ NEW LOGIC: Only generate if BOTH local AND database are missing
        if (
          (!classicalPriv || !pqcPriv) &&
          (!profileData?.public_key || !profileData?.pqc_public_key)
        ) {
          console.log("🔑 No keys found anywhere, generating new keys...");
          const keys = await generateHybridKeyPair();
          classicalPriv = keys.classical.privateKey;
          pqcPriv = keys.pqc.privateKey;
          storeHybridPrivateKeys(classicalPriv, pqcPriv);

          console.log("📤 Uploading NEW public keys to profile...");
          const { error: updateError } = await supabase
            .from("profiles")
            .update({
              public_key: keys.classical.publicKey,
              pqc_public_key: naclUtil.encodeBase64(keys.pqc.publicKey),
            })
            .eq("id", data.user.id);

          if (updateError) {
            console.error("❌ Error updating profile keys:", updateError);
            throw updateError;
          }
          console.log("✅ Keys uploaded successfully");
        } else if (!classicalPriv || !pqcPriv) {
          // ❌ CRITICAL ERROR: Local keys missing but DB has keys
          console.error(
            "❌ CRITICAL: Keys exist in database but not in localStorage!"
          );
          console.error(
            "This means you logged in from a different device/browser."
          );
          console.error(
            "Cannot recover - you need to use the original device or reset account."
          );
          toast.error(
            "Cannot decrypt messages - logged in from different device. Messages encrypted with keys from original device."
          );
          // Don't generate new keys - this would break existing encrypted messages!
        } else {
          console.log("✅ Using existing local keys");
        }

        toast.success("Welcome back with quantum-safe encryption!");
      } else {
        // SIGN UP
        console.log("📝 Attempting sign up...");
        console.log("Email:", email);

        // ✅ Sanitize username: chỉ cho phép a-z, 0-9, _, -
        const sanitizedUsername = (username || email.split("@")[0])
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, "_") // Thay ký tự không hợp lệ bằng _
          .replace(/^_+|_+$/g, "") // Bỏ _ ở đầu/cuối
          .substring(0, 50); // Giới hạn độ dài

        console.log("Sanitized username:", sanitizedUsername);

        // Generate keys FIRST
        console.log("🔑 Generating hybrid keys...");
        const keys = await generateHybridKeyPair();
        console.log("✅ Keys generated successfully");

        // Sign up
        console.log("📤 Creating auth user...");
        const { error, data } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              username: sanitizedUsername,
            },
            emailRedirectTo: `${window.location.origin}/`,
          },
        });

        if (error) {
          console.error("❌ Sign up error:", error);
          throw error;
        }

        console.log("✅ Auth user created:", data.user?.id);

        if (data.user) {
          // Store private keys locally
          console.log("💾 Storing private keys locally...");
          storeHybridPrivateKeys(
            keys.classical.privateKey,
            keys.pqc.privateKey
          );
          console.log("✅ Private keys stored");

          // Check if profile exists (trigger should auto-create it)
          console.log("🔍 Checking if profile was auto-created...");

          // Wait a bit for trigger to execute
          await new Promise((resolve) => setTimeout(resolve, 1000));

          const { data: existingProfile, error: checkError } = await supabase
            .from("profiles")
            .select("id")
            .eq("id", data.user.id)
            .single();

          if (checkError) {
            console.error("❌ Profile check error:", checkError);

            // Try to create profile manually if trigger failed
            console.log("🔧 Attempting manual profile creation...");
            const { error: insertError } = await supabase
              .from("profiles")
              .insert({
                id: data.user.id,
                username: sanitizedUsername,
                public_key: keys.classical.publicKey,
                pqc_public_key: naclUtil.encodeBase64(keys.pqc.publicKey),
              });

            if (insertError) {
              console.error("❌ Manual profile creation failed:", insertError);
              throw new Error(
                `Failed to create profile: ${insertError.message}`
              );
            }
            console.log("✅ Profile created manually");
          } else {
            console.log("✅ Profile exists, updating keys...");
            // Profile exists, just update keys
            const { error: updateError } = await supabase
              .from("profiles")
              .update({
                public_key: keys.classical.publicKey,
                pqc_public_key: naclUtil.encodeBase64(keys.pqc.publicKey),
              })
              .eq("id", data.user.id);

            if (updateError) {
              console.error("❌ Profile update error:", updateError);
              throw updateError;
            }
            console.log("✅ Profile keys updated");
          }

          toast.success("Account created with Hybrid Post-Quantum E2EE!");
        }
      }

      console.log("🎉 Authentication flow completed successfully");
      navigate("/");
    } catch (error: any) {
      console.error("💥 Authentication error:", error);
      toast.error(error.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-primary rounded-full">
              <MessageSquare className="w-8 h-8 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">
            {isLogin ? "Welcome back" : "Create an account"}
          </CardTitle>
          <CardDescription>
            {isLogin
              ? "Sign in to continue messaging"
              : "Sign up to start quantum-safe messaging"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAuth} className="space-y-4">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  placeholder="john_doe"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  pattern="[a-z0-9_-]+"
                  title="Only lowercase letters, numbers, underscore, and hyphen allowed"
                />
                <p className="text-xs text-muted-foreground">
                  Only lowercase letters, numbers, _ and - allowed
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Loading..." : isLogin ? "Sign in" : "Sign up"}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm">
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-primary hover:underline"
            >
              {isLogin
                ? "Don't have an account? Sign up"
                : "Already have an account? Sign in"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
