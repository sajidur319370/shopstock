import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Shows a secret exactly once (the server only keeps its hash). */
export function OneTimeSecretDialog(props: {
  title: string;
  secret: string;
  note: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.secret); // only in secure contexts (https / localhost)
      setCopied(true);
    } catch {
      toast.info('Copy blocked by the browser: select the password and copy it by hand.');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.note}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-md border bg-gray-50 px-3 py-2 font-mono text-lg tracking-wider select-all">
            {props.secret}
          </code>
          <Button variant="outline" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="text-sm text-amber-700">You won&apos;t be able to see this password again.</p>
        <DialogFooter>
          <Button onClick={props.onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
