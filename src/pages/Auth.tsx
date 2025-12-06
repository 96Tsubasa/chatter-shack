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
import { Shield, Lock, Mail, User as UserIcon, Eye, EyeOff } from "lucide-react";
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
  const [showPassword, setShowPassword] = useState(false);
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
        const { error, data } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("public_key, pqc_public_key")
          .eq("id", data.user.id)
          .single();

        if (profileError) throw profileError;

        let classicalPriv = getIdentityPrivateKey();
        let pqcPriv = getPqcPrivateKey();

        if (
          (!classicalPriv || !pqcPriv) &&
          (!profileData?.public_key || !profileData?.pqc_public_key)
        ) {
          const keys = await generateHybridKeyPair();
          classicalPriv = keys.classical.privateKey;
          pqcPriv = keys.pqc.privateKey;
          storeHybridPrivateKeys(classicalPriv, pqcPriv);

          const { error: updateError } = await supabase
            .from("profiles")
            .update({
              public_key: keys.classical.publicKey,
              pqc_public_key: naclUtil.encodeBase64(keys.pqc.publicKey),
            })
            .eq("id", data.user.id);

          if (updateError) throw updateError;
        } else if (!classicalPriv || !pqcPriv) {
          toast.error(
            "Cannot decrypt messages - logged in from different device. Messages encrypted with keys from original device."
          );
        }

        toast.success("Welcome back! Your connection is secured.");
      } else {
        const sanitizedUsername = (username || email.split("@")[0])
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, "_")
          .replace(/^_+|_+$/g, "")
          .substring(0, 50);

        const { data: existingProfile, error: checkError } = await supabase
          .from("profiles")
          .select("id")
          .eq("username", sanitizedUsername)
          .maybeSingle();

        if (checkError) {
          throw new Error(`Failed to check username: ${checkError.message}`);
        }

        if (existingProfile) {
          toast.error(
            `Username "${sanitizedUsername}" is already taken. Please choose another.`
          );
          setLoading(false);
          return;
        }

        const keys = await generateHybridKeyPair();

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

        if (error) throw error;

        if (data.user) {
          storeHybridPrivateKeys(
            keys.classical.privateKey,
            keys.pqc.privateKey
          );

          await new Promise((resolve) => setTimeout(resolve, 1000));

          const { data: existingProfile, error: checkError } = await supabase
            .from("profiles")
            .select("id")
            .eq("id", data.user.id)
            .single();

          if (checkError) {
            const { error: insertError } = await supabase
              .from("profiles")
              .insert({
                id: data.user.id,
                username: sanitizedUsername,
                public_key: keys.classical.publicKey,
                pqc_public_key: naclUtil.encodeBase64(keys.pqc.publicKey),
              });

            if (insertError) {
              if (
                insertError.code === "23505" &&
                insertError.message.includes("username")
              ) {
                throw new Error(
                  `Username "${sanitizedUsername}" was just taken by another user. Please try again with a different username.`
                );
              }

              throw new Error(
                `Failed to create profile: ${insertError.message}`
              );
            }
          } else {
            const { error: updateError } = await supabase
              .from("profiles")
              .update({
                public_key: keys.classical.publicKey,
                pqc_public_key: naclUtil.encodeBase64(keys.pqc.publicKey),
              })
              .eq("id", data.user.id);

            if (updateError) throw updateError;
          }

          toast.success("Account created successfully! Your keys are secured.");
        }
      }

      navigate("/");
    } catch (error: any) {
      toast.error(error.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-primary/5 to-accent/5 p-4 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      <Card className="w-full max-w-md relative backdrop-blur-xl bg-card/80 border-border/50 shadow-2xl">
        <CardHeader className="space-y-3 text-center pb-8">
          {/* Logo with animation */}
          <div className="flex justify-center mb-2">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-primary to-accent blur-xl opacity-50 rounded-full animate-pulse" />
              <div className="relative p-4 bg-gradient-to-br from-primary via-primary to-accent rounded-2xl shadow-xl">
                <Shield className="w-10 h-10 text-white" />
              </div>
            </div>
          </div>
          
          <CardTitle className="text-3xl font-bold bg-gradient-to-r from-primary via-primary to-accent bg-clip-text text-transparent">
            {isLogin ? "Welcome Back" : "Create Account"}
          </CardTitle>
          
          <CardDescription className="text-base">
            {isLogin
              ? "Sign in to access your encrypted conversations"
              : "Join SecureChat with quantum-resistant encryption"}
          </CardDescription>

          {/* Security badges */}
          <div className="flex items-center justify-center gap-2 pt-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 rounded-full text-xs font-medium text-primary">
              <Lock className="w-3 h-3" />
              <span>E2EE</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 rounded-full text-xs font-medium text-accent">
              <Shield className="w-3 h-3" />
              <span>Post-Quantum</span>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleAuth} className="space-y-5">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm font-medium flex items-center gap-2">
                  <UserIcon className="w-4 h-4 text-primary" />
                  Username
                </Label>
                <Input
                  id="username"
                  placeholder="john_doe"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  pattern="[a-z0-9_-]+"
                  title="Only lowercase letters, numbers, underscore, and hyphen allowed"
                  className="h-11"
                />
                <p className="text-xs text-muted-foreground">
                  Only lowercase letters, numbers, _ and - allowed
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium flex items-center gap-2">
                <Mail className="w-4 h-4 text-primary" />
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium flex items-center gap-2">
                <Lock className="w-4 h-4 text-primary" />
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="h-11 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-11 bg-gradient-to-r from-primary to-accent hover:shadow-xl transition-all duration-200 hover:scale-[1.02] text-white font-medium"
              disabled={loading}
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Processing...</span>
                </div>
              ) : isLogin ? (
                "Sign In"
              ) : (
                "Create Account"
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm text-primary hover:text-accent transition-colors font-medium"
            >
              {isLogin
                ? "Don't have an account? Sign up"
                : "Already have an account? Sign in"}
            </button>
          </div>

          {/* Security info footer */}
          <div className="mt-6 pt-6 border-t border-border/50">
            <p className="text-xs text-center text-muted-foreground leading-relaxed">
              Protected by ML-KEM-768 + X25519 hybrid encryption. Your private keys are stored locally and never transmitted.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;