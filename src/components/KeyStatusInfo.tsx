import { Info, Key, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface KeyStatusInfoProps {
  hasLocalKeys: boolean;
  hasDbKeys: boolean;
  isNewKeys?: boolean;
}

const KeyStatusInfo = ({
  hasLocalKeys,
  hasDbKeys,
  isNewKeys,
}: KeyStatusInfoProps) => {
  // All good - both local and DB keys exist
  if (hasLocalKeys && hasDbKeys && !isNewKeys) {
    return (
      <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
        <Key className="h-4 w-4 text-green-600" />
        <AlertTitle className="text-green-800 dark:text-green-200">
          Encryption Keys Active
        </AlertTitle>
        <AlertDescription className="text-green-700 dark:text-green-300">
          Your messages are protected with quantum-safe encryption. You can
          decrypt all messages on this device.
        </AlertDescription>
      </Alert>
    );
  }

  // New keys generated - old messages won't decrypt
  if (isNewKeys) {
    return (
      <Alert className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
        <AlertTriangle className="h-4 w-4 text-yellow-600" />
        <AlertTitle className="text-yellow-800 dark:text-yellow-200">
          New Encryption Keys Generated
        </AlertTitle>
        <AlertDescription className="text-yellow-700 dark:text-yellow-300 space-y-2">
          <p>
            New quantum-safe keys have been created for this device. Previous
            keys were not found.
          </p>
          <ul className="list-disc list-inside text-sm">
            <li>✅ You can send and receive new messages normally</li>
            <li>
              ⚠️ Old messages encrypted with previous keys cannot be decrypted
            </li>
            <li>
              💡 This happens when logging in from a new device or after
              clearing keys
            </li>
          </ul>
        </AlertDescription>
      </Alert>
    );
  }

  // No keys at all (shouldn't happen after login)
  if (!hasLocalKeys && !hasDbKeys) {
    return (
      <Alert className="border-blue-500 bg-blue-50 dark:bg-blue-950">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertTitle className="text-blue-800 dark:text-blue-200">
          Setting Up Encryption
        </AlertTitle>
        <AlertDescription className="text-blue-700 dark:text-blue-300">
          Quantum-safe encryption keys are being generated for your account...
        </AlertDescription>
      </Alert>
    );
  }

  return null;
};

export default KeyStatusInfo;
