// Phone and emergency contact (DESIGN.md → Team and contacts): the form (first visit, account menu, invite page) and the
// contact card that Team and Who's in open.
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { type ContactFields, contactFields, type Me, type TeamMember } from "../../shared/api.ts";
import { firstName, fmtPhone } from "../../shared/people.ts";
import { api } from "../lib/api.ts";
import { useMembers } from "../lib/data.ts";
import { PhoneIcon, TextIcon } from "./icons.tsx";
import { Sheet } from "./Sheet.tsx";

/** Reads and checks the three fields of a form (names phone, emergencyName, emergencyPhone). */
export function readContact(form: HTMLFormElement): { value: ContactFields } | { error: string } {
  const f = new FormData(form);
  const r = contactFields.safeParse({
    phone: String(f.get("phone") ?? ""),
    emergencyName: String(f.get("emergencyName") ?? ""),
    emergencyPhone: String(f.get("emergencyPhone") ?? ""),
  });
  return r.success ? { value: r.data } : { error: r.error.issues[0]?.message ?? "Check the phone numbers" };
}

/** The inputs alone, for forms that hold more (the invite page). */
export function ContactInputs({ me }: { me?: Pick<Me, "phone" | "emergencyName" | "emergencyPhone"> }) {
  const shown = (p: string | null | undefined) => (p ? fmtPhone(p) : "");
  return (
    <>
      <label className="field">
        Mobile phone
        <input name="phone" type="tel" autoComplete="tel" required maxLength={30} defaultValue={shown(me?.phone)} />
      </label>
      <fieldset className="field-group">
        <legend>
          Emergency contact <span className="muted">(optional)</span>
        </legend>
        <label className="field">
          Name
          <input name="emergencyName" autoComplete="off" maxLength={80} defaultValue={me?.emergencyName ?? ""} />
        </label>
        <label className="field">
          Phone
          <input
            name="emergencyPhone"
            type="tel"
            autoComplete="off"
            maxLength={30}
            defaultValue={shown(me?.emergencyPhone)}
          />
        </label>
      </fieldset>
    </>
  );
}

/** Saves the signed-in person's contact details. `first`: the one-time screen shown until a phone is saved. */
export function ContactForm({ me, first, onDone }: { me: Me; first?: boolean; onDone?: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const r = readContact(e.currentTarget);
    if ("error" in r) return setError(r.error);
    setBusy(true);
    try {
      qc.setQueryData(["me"], await api<Me>("/me/contact", { method: "PUT", body: r.value }));
      await qc.invalidateQueries({ queryKey: ["members"] });
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="contact-form" onSubmit={save} noValidate>
      {first ? (
        <>
          <h1>One more thing, {firstName(me.name)}</h1>
          <p className="muted small">
            Add your mobile number so teammates can reach you on the day. Everyone on the team can see it in Team, and
            your emergency contact too.
          </p>
        </>
      ) : (
        <h2>My contact info</h2>
      )}
      <ContactInputs me={me} />
      {error && (
        <p className="small" role="alert" style={{ color: "var(--no-fg)", margin: 0 }}>
          {error}
        </p>
      )}
      <div className="btnrow">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Save
        </button>
        {!first && (
          <button type="button" className="btn btn-outline" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
      {first && <p className="tiny muted">You can change this any time: account menu → My contact info.</p>}
    </form>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
export const Initials = ({ name }: { name: string }) => (
  <span className="initials" aria-hidden="true">
    {initials(name)}
  </span>
);

/** Call and Text open the phone's own apps (tel: and sms: links). */
export function CallText({ phone, name, compact }: { phone: string; name: string; compact?: boolean }) {
  return compact ? (
    <>
      <a className="roundbtn" href={`tel:${phone}`} aria-label={`Call ${name}`}>
        <PhoneIcon />
      </a>
      <a className="roundbtn" href={`sms:${phone}`} aria-label={`Text ${name}`}>
        <TextIcon />
      </a>
    </>
  ) : (
    <div className="calltext">
      <a className="btn btn-primary" href={`tel:${phone}`}>
        <PhoneIcon /> Call
      </a>
      <a className="btn btn-outline" href={`sms:${phone}`}>
        <TextIcon /> Text
      </a>
    </div>
  );
}

export function ContactCard({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const m = member;
  return (
    <Sheet label={`Contact ${m.name}`} onClose={onClose}>
      <div className="contact-card">
        <div className="contact-head">
          <Initials name={m.name} />
          <h2>{m.name}</h2>
          <button type="button" className="linkbtn" onClick={onClose}>
            Close
          </button>
        </div>
        {m.phone ? (
          <>
            <CallText phone={m.phone} name={m.name} />
            <p className="muted small center">{fmtPhone(m.phone)}</p>
          </>
        ) : (
          <p className="muted small">No phone number yet.</p>
        )}
        {m.emergencyName && m.emergencyPhone && (
          <div className="emergency">
            <div className="sub-h">Emergency contact</div>
            <div className="emergency-row">
              <div>
                <b>{m.emergencyName}</b>
                <div className="muted small">{fmtPhone(m.emergencyPhone)}</div>
              </div>
              <a
                className="btn btn-danger btn-sm"
                href={`tel:${m.emergencyPhone}`}
                aria-label={`Call emergency contact ${m.emergencyName}`}
              >
                <PhoneIcon size={16} /> Call
              </a>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** A person's name that opens their contact card (Who's in). Plain text while the directory loads or for a former member. */
export function PersonButton({
  userId,
  children,
  className,
}: {
  userId: string;
  children: React.ReactNode;
  className: string;
}) {
  const members = useMembers().data;
  const [open, setOpen] = useState(false);
  const m = members?.find((x) => x.id === userId && x.active);
  if (!m) return <span className={className}>{children}</span>;
  return (
    <>
      <button type="button" className={`${className} personbtn`} onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && <ContactCard member={m} onClose={() => setOpen(false)} />}
    </>
  );
}
