import type { ChildType, UnionStatus } from "@/core/model/types";

/**
 * `blood`: the person a block belongs to. `spouse`: a partner of the blood person.
 * `linked`: a later appearance of someone already placed elsewhere; always a leaf.
 */
export type NodeKind = "blood" | "spouse" | "linked";

export type BlockMember = { nodeId: string; personId: string; kind: NodeKind };

export type BlockUnion = {
  unionId: string;
  /** Indexes of the two member cards whose gap carries the union; `[i, i]` for a single parent. */
  anchorBetween: [number, number];
  /** Empty when the blood person is collapsed. */
  children: Block[];
};

/** A blood person with their partners, side by side on one row, and the children below. */
export type Block = {
  bloodNodeId: string;
  members: BlockMember[];
  unions: BlockUnion[];
  /** Descendants left out because the blood person is collapsed. */
  hiddenCount: number;
  /** Generation below the root block. */
  depth: number;
};

export type LayoutNode = {
  nodeId: string;
  personId: string;
  kind: NodeKind;
  /** Card top-left. */
  x: number;
  y: number;
  generation: number;
  /** "+N" badge on a collapsed blood person; 0 otherwise. */
  hiddenCount: number;
};

export type LayoutEdge = {
  id: string;
  kind: "union" | "child";
  unionId: string;
  /** Union edges: for line style. */
  status?: UnionStatus;
  /** Child edges: for line style. */
  childType?: ChildType;
  points: [number, number][];
};

export type LayoutResult = {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  bounds: { x: number; y: number; width: number; height: number };
  generationCount: number;
  /** personId -> nodeId of the person's primary card. */
  primaryNode: Record<string, string>;
  /** Persons not placed from the view root, in document order. */
  unreachable: string[];
};
