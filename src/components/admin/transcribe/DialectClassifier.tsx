import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  REVIEWABLE_DIALECTS,
  findSubvariety,
  subvarietiesFor,
} from "../../../../supabase/functions/_shared/dialectSubvarieties";

/**
 * The value a Select uses to mean "nothing chosen".
 *
 * Radix refuses an empty string as an item value — it reserves it for the
 * placeholder — so the cleared state needs a sentinel that cannot collide with
 * a real sub-variety id. It never leaves this component: `onChange` is handed
 * `null`.
 */
const NONE = "__none__";

interface DialectClassifierProps {
  dialect: string;
  subvariety: string | null;
  onChange: (next: { dialect: string; subvariety: string | null }) => void;
  disabled?: boolean;
}

/**
 * What variety is this clip actually in — two dropdowns, second dependent.
 *
 * `discover_videos.dialect` stops at the country, which is roughly the
 * resolution of a passport rather than of a dialect: a Jeddah clip and a Riyadh
 * clip land on the same "Saudi" label, and every generator that conditions on
 * that label then teaches two systems at once and calls it one. The reviewer is
 * the only person in the pipeline who can hear the difference, so this is the
 * screen where it gets said.
 *
 * Two levels rather than one flat list, deliberately. Every sub-variety in the
 * taxonomy reached from a single dropdown would be forty-odd entries; reached
 * from the country it is never more than seven, and the reviewer has already
 * answered the easy half of the question before the hard half is asked.
 *
 * Changing the country clears the sub-variety here as well as on the server.
 * Doing it in one place would be enough for correctness — the server is the one
 * that counts — but leaving "Ḥijāzi" visible under "Egyptian" until the save
 * comes back reads as a bug even though it isn't.
 */
export function DialectClassifier({
  dialect,
  subvariety,
  onChange,
  disabled = false,
}: DialectClassifierProps) {
  const options = subvarietiesFor(dialect);
  // A label already on the row that the canonical list does not offer —
  // "Emirati", written by the curriculum builder where the video form writes
  // "UAE". Appended rather than ignored: a Select whose value matches no item
  // renders its placeholder, so the reviewer would see an empty box over a
  // video that is in fact classified, and the first thing they touched would
  // silently re-label it.
  const dialectOptions: string[] = REVIEWABLE_DIALECTS.includes(
    dialect as (typeof REVIEWABLE_DIALECTS)[number],
  )
    ? [...REVIEWABLE_DIALECTS]
    // Guarded against the empty string, which Radix refuses as an item value.
    // The column is NOT NULL with a default so this should not arise, and an
    // exception thrown inside a dropdown is a poor way to find out that it did.
    : [...REVIEWABLE_DIALECTS, ...(dialect ? [dialect] : [])];
  const chosen = options.find((option) => option.id === subvariety);
  // A sub-variety set under a country that has since changed. Kept visible
  // rather than silently dropped: the reviewer should see what the row used to
  // claim, and be told why the dropdown no longer offers it.
  const orphan = !chosen && subvariety ? findSubvariety(subvariety) : undefined;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="dialect-country">Dialect</Label>
          <Select
            value={dialect}
            disabled={disabled}
            onValueChange={(value) =>
              onChange({
                dialect: value,
                subvariety: subvarietiesFor(value).some((option) => option.id === subvariety)
                  ? subvariety
                  : null,
              })
            }
          >
            <SelectTrigger id="dialect-country" aria-label="Dialect">
              <SelectValue placeholder="Pick a dialect" />
            </SelectTrigger>
            <SelectContent>
              {dialectOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/*
          Hidden rather than disabled when the dialect has no taxonomy (MSA,
          Levantine, Maghrebi — none of which this app teaches). A greyed-out
          control invites a reviewer to work out why it will not open; an absent
          one asks nothing of them.
        */}
        {options.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="dialect-subvariety">Sub-dialect</Label>
            <Select
              value={chosen ? chosen.id : NONE}
              disabled={disabled}
              onValueChange={(value) =>
                onChange({ dialect, subvariety: value === NONE ? null : value })
              }
            >
              <SelectTrigger id="dialect-subvariety" aria-label="Sub-dialect">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/*
                  "Not sure" and not "None": a reviewer who cannot place a clip
                  has said something useful, and an option that sounds like a
                  failure is one they will avoid by guessing.
                */}
                <SelectItem value={NONE}>Not sure / not set</SelectItem>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    <span className="flex flex-col items-start">
                      <span>{option.label}</span>
                      <span dir="rtl" className="font-cairo text-xs text-muted-foreground">
                        {option.labelAr}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {chosen && <p className="text-xs text-muted-foreground">{chosen.hint}</p>}

      {orphan && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          This video was marked <strong>{orphan.label}</strong>, which is not a {dialect}{" "}
          sub-dialect. Saving will clear it — pick the right one first if you meant to keep it.
        </p>
      )}

      {options.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No sub-dialects are catalogued for {dialect}.
        </p>
      )}
    </div>
  );
}

export default DialectClassifier;
