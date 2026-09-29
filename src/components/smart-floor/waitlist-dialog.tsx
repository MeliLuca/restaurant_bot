"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FloorMap, TableTag, WaitlistEntry } from "@/lib/database.types";
import { useT } from "@/lib/i18n/use-translation";
import type { WalkIn } from "@/lib/smart-floor/walk-in";
import { addToWaitlist, updateWaitlistEntry } from "@/lib/smart-floor/waitlist-api";
import { PartyInputs, parsePartySize } from "./walk-in-shared";

/** Add a party to the waitlist (from "Trova posto" or empty), or edit one */
export function WaitlistDialog({
  open,
  editing,
  prefill,
  tags,
  maps,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** The entry being edited; null = a new one */
  editing: WaitlistEntry | null;
  /** A new entry's size / needs / room, as typed in "Trova posto" */
  prefill: WalkIn | null;
  tags: TableTag[];
  maps: FloorMap[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [party, setParty] = useState("2");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [mapId, setMapId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.customer_name ?? "");
    setPhone(editing?.phone ?? "");
    setParty(String(editing?.party_size ?? prefill?.partySize ?? 2));
    setTagIds(editing?.tag_ids ?? prefill?.tagIds ?? []);
    setMapId(editing ? editing.map_id : (prefill?.mapId ?? null));
    setNotes(editing?.notes ?? "");
  }, [open, editing, prefill]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const size = parsePartySize(party);
    if (!name.trim()) return toast.error(t("floor.customerNameRequired"));
    if (size === null) return toast.error(t("floor.partySizeMin"));
    const fields = {
      customer_name: name.trim(),
      party_size: size,
      phone: phone.trim() || null,
      tag_ids: tagIds,
      map_id: mapId,
      notes: notes.trim() || null,
    };
    setBusy(true);
    try {
      if (editing) await updateWaitlistEntry(editing.id, fields);
      else await addToWaitlist(fields);
      await onSaved();
      toast.success(
        t(editing ? "queue.updated" : "queue.added", { name: fields.customer_name }),
      );
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.somethingWrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(editing ? "queue.editTitle" : "queue.addTitle")}</DialogTitle>
          <DialogDescription>{t("queue.addHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="wl-name">{t("floor.customerName")}</Label>
            <Input
              id="wl-name"
              className="h-11"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("floor.customerNamePlaceholder")}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wl-phone">{t("reservations.phoneOptional")}</Label>
            <Input
              id="wl-phone"
              className="h-11"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="333 123 4567"
            />
          </div>
          <PartyInputs
            idPrefix="wl"
            party={party}
            onParty={setParty}
            tags={tags}
            tagIds={tagIds}
            onTags={setTagIds}
            maps={maps}
            mapId={mapId}
            onMap={setMapId}
          />
          <div className="grid gap-2">
            <Label htmlFor="wl-notes">{t("floor.notesOptional")}</Label>
            <Input
              id="wl-notes"
              className="h-11"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("queue.notesPlaceholder")}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" className="h-11" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" className="h-11 px-6" disabled={busy}>
              {busy ? t("common.saving") : t(editing ? "common.save" : "queue.addSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
