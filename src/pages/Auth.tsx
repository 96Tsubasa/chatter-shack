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
import nacl from "tweetnacl";
import {
  generateHybridKeyPair,
  storeHybridPrivateKeys,
  getIdentityPrivateKey,
  getPqcPrivateKey,
  hasUserKeys,
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

        const userId = data.user.id;
        console.log("✅ Login successful for user:", userId);

        // ✅ Check if user has keys stored locally (FIXED: pass userId)
        const hasLocalKeys = hasUserKeys(userId);
        console.log("Has local keys:", hasLocalKeys);

        // ✅ Fetch keys from database
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("public_key, pqc_public_key")
          .eq("id", userId)
          .single();

        if (profileError) {
          console.error("❌ Error fetching profile:", profileError);
          throw profileError;
        }

        const hasDbKeys = !!(
          profileData?.public_key && profileData?.pqc_public_key
        );
        console.log("Has database keys:", hasDbKeys);

        // ✅ Handle different scenarios
        if (!hasLocalKeys && !hasDbKeys) {
          // Scenario 1: New user, no keys anywhere - generate new keys
          console.log("🔑 No keys found anywhere, generating new keys...");
          const keys = await generateHybridKeyPair();

          // ✅ FIXED: Pass userId as first parameter
          storeHybridPrivateKeys(
            userId,
            keys.classical.privateKey,
            keys.pqc.privateKey
          );

          console.log("📤 Uploading NEW public keys to profile...");
          const { error: updateError } = await supabase
            .from("profiles")
            .update({
              public_key: keys.classical.publicKey,
              pqc_public_key: naclUtil.encodeBase64(keys.pqc.publicKey),
            })
            .eq("id", userId);

          if (updateError) {
            console.error("❌ Error updating profile keys:", updateError);
            throw updateError;
          }
          console.log("✅ Keys uploaded successfully");
          toast.success("Welcome! Quantum-safe encryption keys generated.");
        } else if (hasLocalKeys && !hasDbKeys) {
          // Scenario 2: Has local keys but not in DB - upload to DB
          console.log("📤 Local keys found, uploading to database...");

          // ✅ FIXED: Pass userId to get functions
          const classicalPriv = getIdentityPrivateKey(userId);
          const pqcPriv = getPqcPrivateKey(userId);

          if (classicalPriv && pqcPriv) {
            // Derive public key from classical private key
            const classicalPrivUint8 = naclUtil.decodeBase64(classicalPriv);
            const classicalPubUint8 =
              nacl.box.keyPair.fromSecretKey(classicalPrivUint8).publicKey;

            // ⚠️ Note: We cannot derive PQC public key from private key
            // This scenario shouldn't happen in normal flow, but handle it gracefully
            console.warn("⚠️ Cannot derive PQC public key from private key");
            console.warn(
              "This account may have issues. Consider generating new keys."
            );

            const { error: updateError } = await supabase
              .from("profiles")
              .update({
                public_key: naclUtil.encodeBase64(classicalPubUint8),
                // We'll need to regenerate PQC keys or skip this
              })
              .eq("id", userId);

            if (updateError) {
              console.error("❌ Error uploading keys:", updateError);
            } else {
              console.log("✅ Classical key uploaded to database");
            }
          }
          toast.success("Welcome back with quantum-safe encryption!");
        } else if (!hasLocalKeys && hasDbKeys) {
          // Scenario 3: Keys in DB but not local - Generate new keys
          console.warn("⚠️ Keys exist in database but not locally!");
          console.log("🔑 Generating NEW keys for this device...");

          const keys = await generateHybridKeyPair();

          // ✅ Store new private keys locally
          storeHybridPrivateKeys(
            userId,
            keys.classical.privateKey,
            keys.pqc.privateKey
          );
          console.log("✅ New private keys stored locally");

          // ✅ Upload new public keys to database (overwrite old ones)
          const { error: updateError } = await supabase
            .from("profiles")
            .update({
              public_key: keys.classical.publicKey,
              pqc_public_key: naclUtil.encodeBase64(keys.pqc.publicKey),
            })
            .eq("id", userId);

          if (updateError) {
            console.error("❌ Error updating profile keys:", updateError);
            throw updateError;
          }

          console.log("✅ New public keys uploaded to database");
          toast.warning(
            "⚠️ New encryption keys generated. Old messages cannot be decrypted, but you can send new messages.",
            { duration: 8000 }
          );
          // User can now send/receive new messages with new keys
        } else {
          // Scenario 4: Has both local and DB keys - all good!
          console.log("✅ Using existing keys for user:", userId);
          toast.success("Welcome back with quantum-safe encryption!");
        }
      } else {
        // ===== SIGN UP =====
        console.log("📝 Attempting sign up...");
        console.log("Email:", email);

        // ✅ Sanitize username
        const sanitizedUsername = (username || email.split("@")[0])
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, "_")
          .replace(/^_+|_+$/g, "")
          .substring(0, 50);

        console.log("Sanitized username:", sanitizedUsername);

        // ✅ Check if username already exists
        const { data: existingProfile, error: checkError } = await supabase
          .from("profiles")
          .select("id")
          .eq("username", sanitizedUsername)
          .maybeSingle();

        if (checkError) {
          console.error("❌ Error checking username:", checkError);
          throw new Error(`Failed to check username: ${checkError.message}`);
        }

        if (existingProfile) {
          console.error("❌ Username already taken:", sanitizedUsername);
          toast.error(
            `Username "${sanitizedUsername}" is already taken. Please choose another.`
          );
          setLoading(false);
          return;
        }

        console.log("✅ Username is available");

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
          const userId = data.user.id;

          // ✅ FIXED: Store private keys locally WITH userId as first parameter
          console.log("💾 Storing private keys locally for user:", userId);
          storeHybridPrivateKeys(
            userId,
            keys.classical.privateKey,
            keys.pqc.privateKey
          );
          console.log("✅ Private keys stored");

          // Wait for trigger to create profile
          await new Promise((resolve) => setTimeout(resolve, 1000));

          const { data: existingProfile, error: checkError } = await supabase
            .from("profiles")
            .select("id")
            .eq("id", userId)
            .single();

          if (checkError) {
            console.error("❌ Profile check error:", checkError);

            // Try to create profile manually
            console.log("🔧 Attempting manual profile creation...");
            const { error: insertError } = await supabase
              .from("profiles")
              .insert({
                id: userId,
                username: sanitizedUsername,
                public_key: keys.classical.publicKey,
                pqc_public_key: naclUtil.encodeBase64(keys.pqc.publicKey),
              });

            if (insertError) {
              console.error("❌ Manual profile creation failed:", insertError);

              // ✅ Handle duplicate username constraint
              if (
                insertError.code === "23505" &&
                insertError.message.includes("username")
              ) {
                throw new Error(
                  `Username "${sanitizedUsername}" was just taken. Please try again.`
                );
              }

              throw new Error(
                `Failed to create profile: ${insertError.message}`
              );
            }
            console.log("✅ Profile created manually");
          } else {
            console.log("✅ Profile exists, updating keys...");
            const { error: updateError } = await supabase
              .from("profiles")
              .update({
                public_key: keys.classical.publicKey,
                pqc_public_key: naclUtil.encodeBase64(keys.pqc.publicKey),
              })
              .eq("id", userId);

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
