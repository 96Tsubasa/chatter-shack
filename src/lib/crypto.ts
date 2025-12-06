// crypto.ts - FIXED with multi-user support
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import { MlKem768 } from 'mlkem';

// ✅ NEW: Multi-user storage keys with userId prefix
const getIdentityPrivateKeyName = (userId: string) => `identity_private_key_${userId}`;
const getPqcIdentityPrivateKeyName = (userId: string) => `pqc_identity_private_key_${userId}`;
const EPHEMERAL_KEYS_PREFIX = 'ephemeral_key_';

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

export interface HybridEncryptedMessage {
  ciphertext: string;
  nonce: string;
  ephemeralPublicKey: string;
  kemCapsule: string;
}

/**
 * Generate hybrid key pair: Classical X25519 + PQC ML-KEM-768
 */
export async function generateHybridKeyPair() {
  const classical = nacl.box.keyPair();
  const pqcInstance = new MlKem768();
  const [pqcPublicKey, pqcPrivateKey] = await pqcInstance.generateKeyPair();
  
  return {
    classical: {
      publicKey: naclUtil.encodeBase64(classical.publicKey),
      privateKey: naclUtil.encodeBase64(classical.secretKey),
    },
    pqc: {
      publicKey: pqcPublicKey,   
      privateKey: pqcPrivateKey,  
    }
  };
}

/**
 * ✅ NEW: Store hybrid private keys in localStorage with userId
 */
export function storeHybridPrivateKeys(
  userId: string,
  classicalPrivateKey: string,
  pqcPrivateKey: Uint8Array
): void {
  try {
    localStorage.setItem(getIdentityPrivateKeyName(userId), classicalPrivateKey);
    localStorage.setItem(getPqcIdentityPrivateKeyName(userId), naclUtil.encodeBase64(pqcPrivateKey));
    console.log(`✅ Stored keys for user: ${userId}`);
  } catch (e) {
    console.error('Failed to store private keys:', e);
    throw new Error('Storage failed - localStorage might be full or disabled');
  }
}

/**
 * ✅ NEW: Retrieve classical identity private key for specific user
 */
export function getIdentityPrivateKey(userId: string): string | null {
  return localStorage.getItem(getIdentityPrivateKeyName(userId));
}

/**
 * ✅ NEW: Retrieve PQC identity private key for specific user
 */
export function getPqcPrivateKey(userId: string): Uint8Array | null {
  const stored = localStorage.getItem(getPqcIdentityPrivateKeyName(userId));
  if (!stored) return null;
  
  try {
    return naclUtil.decodeBase64(stored);
  } catch (e) {
    console.error('Invalid PQC private key format:', e);
    return null;
  }
}

/**
 * Store ephemeral private key for a conversation (classical only, for forward secrecy)
 */
export function storeEphemeralPrivateKey(conversationId: string, privateKey: string): void {
  localStorage.setItem(`${EPHEMERAL_KEYS_PREFIX}${conversationId}`, privateKey);
}

/**
 * Retrieve ephemeral private key for a conversation
 */
export function getEphemeralPrivateKey(conversationId: string): string | null {
  return localStorage.getItem(`${EPHEMERAL_KEYS_PREFIX}${conversationId}`);
}

/**
 * Hybrid Encrypt: ML-KEM encapsulate shared secret → Hybrid XOR with X25519 → Encrypt
 */
export async function encryptMessage(
  message: string,
  recipientClassicalPublicKey: string,
  recipientPqcPublicKey: string
): Promise<HybridEncryptedMessage> {
  console.log("🔐 === ENCRYPTION START ===");
  console.log("Message length:", message.length);
  console.log("Recipient classical key length:", recipientClassicalPublicKey.length);
  console.log("Recipient PQC key length:", recipientPqcPublicKey.length);

  // Validate inputs
  if (!message || !recipientClassicalPublicKey || !recipientPqcPublicKey) {
    throw new Error('Missing required encryption parameters');
  }

  try {
    const ephemeralKeyPair = nacl.box.keyPair();
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const messageUint8 = naclUtil.decodeUTF8(message);
    const recipientClassicalUint8 = naclUtil.decodeBase64(recipientClassicalPublicKey);
    const recipientPqcUint8 = naclUtil.decodeBase64(recipientPqcPublicKey);

    console.log("✅ All inputs decoded");
    console.log("Sizes:", {
      message: messageUint8.length,
      recipientClassical: recipientClassicalUint8.length,
      recipientPqc: recipientPqcUint8.length,
      ephemeralPublic: ephemeralKeyPair.publicKey.length,
      ephemeralSecret: ephemeralKeyPair.secretKey.length
    });

    // Step 1: ML-KEM-768 encapsulate
    console.log("🔒 Step 1: ML-KEM encapsulation...");
    const pqcInstance = new MlKem768();
    const [kemCapsule, sharedSecret] = await pqcInstance.encap(recipientPqcUint8);
    console.log("✅ ML-KEM shared secret:", sharedSecret.length, "bytes");

    // Step 2: X25519 ephemeral shared secret
    console.log("🔒 Step 2: X25519 key exchange...");
    const ephemeralShared = nacl.box.before(recipientClassicalUint8, ephemeralKeyPair.secretKey);
    console.log("✅ X25519 shared secret:", ephemeralShared.length, "bytes");

    // Step 3: XOR hybrid key
    console.log("🔀 Step 3: XOR hybrid key...");
    const finalKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      finalKey[i] = sharedSecret[i] ^ ephemeralShared[i];
    }
    console.log("✅ Final hybrid key generated");

    // Step 4: Encrypt with secretbox (symmetric encryption)
    console.log("🔒 Step 4: NaCl secretbox...");
    const encrypted = nacl.secretbox(messageUint8, nonce, finalKey);
    console.log("✅ Encrypted:", encrypted.length, "bytes");
    console.log("First 8 bytes of final key (encryption):", Array.from(finalKey.slice(0, 8)));

    const result = {
      ciphertext: naclUtil.encodeBase64(encrypted),
      nonce: naclUtil.encodeBase64(nonce),
      ephemeralPublicKey: naclUtil.encodeBase64(ephemeralKeyPair.publicKey),
      kemCapsule: naclUtil.encodeBase64(kemCapsule),
    };

    console.log("✅ Encryption complete");
    console.log("Result structure:", {
      ciphertextLength: result.ciphertext.length,
      nonceLength: result.nonce.length,
      ephemeralKeyLength: result.ephemeralPublicKey.length,
      kemCapsuleLength: result.kemCapsule.length
    });
    console.log("🔐 === ENCRYPTION END ===");
    return result;
  } catch (error) {
    console.error('❌ === ENCRYPTION FAILED ===');
    console.error('Encryption error:', error);
    throw new Error(`Hybrid encryption failed: ${error}`);
  }
}

/**
 * ✅ UPDATED: Hybrid Decrypt with userId parameter
 * Supports both old (box.after) and new (secretbox) formats
 */
export async function decryptMessage(
  encryptedMessage: HybridEncryptedMessage,
  senderEphemeralPublicKey: string,
  userId: string, // ✅ NEW: Need userId to get correct keys
  useOldFormat: boolean = false
): Promise<string> {
  console.log("🔓 === DECRYPTION START ===");
  console.log("User ID:", userId);
  console.log("Using old format (box.after):", useOldFormat);
  console.log("Encrypted message structure:", {
    hasCiphertext: !!encryptedMessage.ciphertext,
    hasNonce: !!encryptedMessage.nonce,
    hasEphemeralKey: !!encryptedMessage.ephemeralPublicKey,
    hasKemCapsule: !!encryptedMessage.kemCapsule
  });

  // ✅ Get keys for specific user
  const identityPrivKey = getIdentityPrivateKey(userId);
  if (!identityPrivKey) {
    throw new Error(`Identity private key not found for user: ${userId}`);
  }
  console.log("✅ Identity private key found for user");

  const recipientPqcPrivateKey = getPqcPrivateKey(userId);
  if (!recipientPqcPrivateKey) {
    throw new Error(`PQC private key not found for user: ${userId}`);
  }
  console.log("✅ PQC private key found for user");

  try {
    const ciphertext = naclUtil.decodeBase64(encryptedMessage.ciphertext);
    const nonce = naclUtil.decodeBase64(encryptedMessage.nonce);
    
    // Use ephemeral key from the encrypted message itself
    const senderEphemeralUint8 = naclUtil.decodeBase64(encryptedMessage.ephemeralPublicKey);
    const kemCapsuleUint8 = naclUtil.decodeBase64(encryptedMessage.kemCapsule);
    
    // Decode recipient's identity PRIVATE key (already in localStorage)
    const identityPrivKeyUint8 = naclUtil.decodeBase64(identityPrivKey);

    console.log("✅ All base64 decoded successfully");
    console.log("Sizes:", {
      ciphertext: ciphertext.length,
      nonce: nonce.length,
      ephemeralKey: senderEphemeralUint8.length,
      kemCapsule: kemCapsuleUint8.length,
      identityPrivKey: identityPrivKeyUint8.length,
      pqcPrivKey: recipientPqcPrivateKey.length
    });

    // Step 1: ML-KEM decapsulate
    console.log("🔒 Step 1: ML-KEM decapsulation...");
    const pqcInstance = new MlKem768();
    const sharedSecret = await pqcInstance.decap(kemCapsuleUint8, recipientPqcPrivateKey);
    console.log("✅ ML-KEM shared secret:", sharedSecret.length, "bytes");

    // Step 2: X25519 ephemeral shared secret
    console.log("🔒 Step 2: X25519 key exchange...");
    const ephemeralShared = nacl.box.before(
      senderEphemeralUint8,
      identityPrivKeyUint8
    );
    console.log("✅ X25519 shared secret:", ephemeralShared.length, "bytes");

    // Step 3: XOR hybrid key
    console.log("🔀 Step 3: XOR hybrid key...");
    const finalKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      finalKey[i] = sharedSecret[i] ^ ephemeralShared[i];
    }
    console.log("✅ Final hybrid key generated");
    console.log("First 8 bytes of final key:", Array.from(finalKey.slice(0, 8)));

    // Step 4: Decrypt (with backward compatibility)
    let decrypted: Uint8Array | null;
    
    if (useOldFormat) {
      // ⚠️ OLD FORMAT: Use box.open.after
      console.log("🔓 Step 4: NaCl box.open.after (old format)...");
      decrypted = nacl.box.open.after(ciphertext, nonce, finalKey);
    } else {
      // ✅ NEW FORMAT: Use secretbox.open
      console.log("🔓 Step 4: NaCl secretbox.open (new format)...");
      decrypted = nacl.secretbox.open(ciphertext, nonce, finalKey);
      
      // ✅ Auto-fallback to old format if new format fails
      if (!decrypted) {
        console.log("⚠️ New format failed, trying old format...");
        decrypted = nacl.box.open.after(ciphertext, nonce, finalKey);
        if (decrypted) {
          console.log("✅ Successfully decrypted with old format!");
        }
      }
    }

    if (!decrypted) {
      console.error("❌ Decryption returned null (tried both formats)");
      console.error("This means the final key is incorrect");
      throw new Error('Decryption failed - invalid ciphertext or keys');
    }

    const plaintext = naclUtil.encodeUTF8(decrypted);
    console.log("✅ Decrypted successfully:", plaintext);
    console.log("🔓 === DECRYPTION END ===");
    return plaintext;
  } catch (error) {
    console.error('❌ === DECRYPTION FAILED ===');
    console.error('Decryption error:', error);
    throw new Error(`Hybrid decryption failed: ${error}`);
  }
}

/**
 * ✅ NEW: Clear all keys for specific user on logout
 */
export function clearUserKeys(userId: string): void {
  localStorage.removeItem(getIdentityPrivateKeyName(userId));
  localStorage.removeItem(getPqcIdentityPrivateKeyName(userId));
  console.log(`✅ Cleared keys for user: ${userId}`);
}

/**
 * ✅ NEW: Clear ALL keys for ALL users (use with caution)
 */
export function clearAllKeys(): void {
  const keys = Object.keys(localStorage);
  keys.forEach(key => {
    if (key.startsWith('identity_private_key_') || 
        key.startsWith('pqc_identity_private_key_') ||
        key.startsWith(EPHEMERAL_KEYS_PREFIX)) {
      localStorage.removeItem(key);
    }
  });
  console.log('✅ Cleared all encryption keys');
}

/**
 * ✅ NEW: List all users with stored keys
 */
export function listUsersWithKeys(): string[] {
  const keys = Object.keys(localStorage);
  const userIds = new Set<string>();
  
  keys.forEach(key => {
    if (key.startsWith('identity_private_key_')) {
      const userId = key.replace('identity_private_key_', '');
      userIds.add(userId);
    }
  });
  
  return Array.from(userIds);
}

/**
 * ✅ NEW: Check if user has keys stored
 */
export function hasUserKeys(userId: string): boolean {
  return !!(getIdentityPrivateKey(userId) && getPqcPrivateKey(userId));
}

/**
 * Derive conversation-specific ephemeral key (classical X25519)
 */
export function deriveConversationKeyPair(conversationId: string): KeyPair {
  const existingPrivateKey = getEphemeralPrivateKey(conversationId);
  
  if (existingPrivateKey) {
    const privateKeyUint8 = naclUtil.decodeBase64(existingPrivateKey);
    const publicKeyUint8 = nacl.box.keyPair.fromSecretKey(privateKeyUint8).publicKey;
    
    return {
      publicKey: naclUtil.encodeBase64(publicKeyUint8),
      privateKey: existingPrivateKey,
    };
  }
  
  const rawPair = nacl.box.keyPair();
  const keyPair: KeyPair = {
    publicKey: naclUtil.encodeBase64(rawPair.publicKey),
    privateKey: naclUtil.encodeBase64(rawPair.secretKey),
  };
  storeEphemeralPrivateKey(conversationId, keyPair.privateKey);
  
  return keyPair;
}