import type { FuzzyDate } from "@/core/dates/fuzzy";

export type { FuzzyDate };

export type Gender = "male" | "female";

export type Person = {
  id: string;
  firstName: string;
  lastName: string;
  nickname?: string;
  /** Name in a native script, e.g. Urdu or Arabic. */
  nativeName?: string;
  gender: Gender;
  /** "Unknown father/mother": a stand-in created by the system, not by the user. */
  isPlaceholder?: boolean;
  isLiving: boolean;
  birth?: { date?: FuzzyDate; place?: string };
  death?: { date?: FuzzyDate; place?: string };
  /** Blob key in IndexedDB. */
  photoId?: string;
  notes?: string;
};

export type UnionStatus = "married" | "partner" | "engaged" | "divorced" | "separated" | "widowed";

export type ChildType = "biological" | "adopted" | "step" | "foster";

export type Union = {
  id: string;
  /** Person ids. */
  partners: [string] | [string, string];
  status: UnionStatus;
  start?: FuzzyDate;
  end?: FuzzyDate;
  /** Array order is sibling order. */
  children: { personId: string; type: ChildType }[];
};

export type TreeDocument = {
  id: string;
  name: string;
  schemaVersion: 1;
  rootPersonId?: string;
  persons: Record<string, Person>;
  unions: Record<string, Union>;
  /** personId -> ordered union ids. */
  unionOrder: Record<string, string[]>;
  settings: { theme: string; colorMode: string; direction: "ltr" | "rtl" };
  createdAt: string;
  updatedAt: string;
};

export type PersonInput = Partial<Omit<Person, "id">> & { gender: Gender };
