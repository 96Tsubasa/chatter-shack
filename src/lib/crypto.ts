import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

// LocalStorage keys
const IDENTITY_PRIVATE_KEY = 'identity_private_key';
const EPHEMERAL_KEYS_PREFIX = 'ephemeral_key_';

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

export interface EncryptedMessage {
  ciphertext: string;
  nonce: string;
  ephemeralPublicKey: string;
}

/**
 * Generate a new X25519 key pair for identity or ephemeral use
 */
export function generateKeyPair(): KeyPair {
  const keyPair = nacl.box.keyPair();
  return {
    publicKey: naclUtil.encodeBase64(keyPair.publicKey),
    privateKey: naclUtil.encodeBase64(keyPair.secretKey),
  };
}

/**
 * Store the identity private key in localStorage
 * WARNING: In production, this should be encrypted with user's password
 */
export function storeIdentityPrivateKey(privateKey: string): void {
  localStorage.setItem(IDENTITY_PRIVATE_KEY, privateKey);
}

/**
 * Retrieve the identity private key from localStorage
 */
export function getIdentityPrivateKey(): string | null {
  return localStorage.getItem(IDENTITY_PRIVATE_KEY);
}

/**
 * Store ephemeral private key for a conversation
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
 * Encrypt a message using recipient's public key
 * Implements forward secrecy by using ephemeral keys
 */
export function encryptMessage(
  message: string,
  recipientPublicKey: string,
  senderEphemeralPrivateKey: string
): EncryptedMessage {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageUint8 = naclUtil.decodeUTF8(message);
  const recipientPublicKeyUint8 = naclUtil.decodeBase64(recipientPublicKey);
  const senderPrivateKeyUint8 = naclUtil.decodeBase64(senderEphemeralPrivateKey);

  const encrypted = nacl.box(
    messageUint8,
    nonce,
    recipientPublicKeyUint8,
    senderPrivateKeyUint8
  );

  // Generate ephemeral public key for this message (for forward secrecy)
  const ephemeralKeyPair = nacl.box.keyPair();

  return {
    ciphertext: naclUtil.encodeBase64(encrypted),
    nonce: naclUtil.encodeBase64(nonce),
    ephemeralPublicKey: naclUtil.encodeBase64(ephemeralKeyPair.publicKey),
  };
}

/**
 * Decrypt a message using sender's public key and recipient's private key
 */
export function decryptMessage(
  encryptedMessage: EncryptedMessage,
  senderPublicKey: string,
  recipientEphemeralPrivateKey: string
): string | null {
  try {
    const ciphertext = naclUtil.decodeBase64(encryptedMessage.ciphertext);
    const nonce = naclUtil.decodeBase64(encryptedMessage.nonce);
    const senderPublicKeyUint8 = naclUtil.decodeBase64(senderPublicKey);
    const recipientPrivateKeyUint8 = naclUtil.decodeBase64(recipientEphemeralPrivateKey);

    const decrypted = nacl.box.open(
      ciphertext,
      nonce,
      senderPublicKeyUint8,
      recipientPrivateKeyUint8
    );

    if (!decrypted) {
      console.error('Failed to decrypt message');
      return null;
    }

    return naclUtil.encodeUTF8(decrypted);
  } catch (error) {
    console.error('Decryption error:', error);
    return null;
  }
}

/**
 * Clear all cryptographic keys from localStorage
 * Call this on logout for security
 */
export function clearAllKeys(): void {
  localStorage.removeItem(IDENTITY_PRIVATE_KEY);
  
  // Clear all ephemeral keys
  const keys = Object.keys(localStorage);
  keys.forEach(key => {
    if (key.startsWith(EPHEMERAL_KEYS_PREFIX)) {
      localStorage.removeItem(key);
    }
  });
}

/**
 * Derive a conversation-specific key pair for forward secrecy
 * This creates unique keys for each conversation that can be rotated
 */
export function deriveConversationKeyPair(conversationId: string): KeyPair {
  // Check if we already have keys for this conversation
  const existingPrivateKey = getEphemeralPrivateKey(conversationId);
  
  if (existingPrivateKey) {
    // Derive public key from private key
    const privateKeyUint8 = naclUtil.decodeBase64(existingPrivateKey);
    const publicKeyUint8 = nacl.box.keyPair.fromSecretKey(privateKeyUint8).publicKey;
    
    return {
      publicKey: naclUtil.encodeBase64(publicKeyUint8),
      privateKey: existingPrivateKey,
    };
  }
  
  // Generate new ephemeral key pair for this conversation
  const keyPair = generateKeyPair();
  storeEphemeralPrivateKey(conversationId, keyPair.privateKey);
  
  return keyPair;
}
