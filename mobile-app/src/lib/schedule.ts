/**
 * Timetable math: which blocks go where, and which sections clash.
 * Same rule as the extension: two sections clash when they share a day and their times overlap.
 */
import { slotsOf, toMinutes, WEEK_DAYS } from './courses';
import type { Course } from './types';

export interface Block {
  course: Course;
  day: string;
  start: number;
  end: number;
  location?: string;
}

/** One block per (time slot × day) for a section. */
export const blocksOf = (course: Course): Block[] =>
  slotsOf(course).flatMap((slot) =>
    slot.days.map((day) => ({
      course,
      day,
      start: toMinutes(slot.startTime),
      end: toMinutes(slot.endTime),
      location: slot.location ?? course.location,
    })),
  );

/** Same day and the times overlap. */
export const blocksOverlap = (a: Block, b: Block) => a.day === b.day && a.start < b.end && b.start < a.end;

/** True when two sections meet at the same time on the same day. */
export const sectionsClash = (a: Course, b: Course): boolean => {
  const ba = blocksOf(a);
  const bb = blocksOf(b);
  return ba.some((x) => bb.some((y) => blocksOverlap(x, y)));
};

/** The first other chosen section that meets at the same time as `candidate`, if any. */
export const findClash = (candidate: Course, chosen: Course[]): Course | null =>
  chosen.find((c) => c.id !== candidate.id && sectionsClash(candidate, c)) ?? null;

/** Every block of the chosen sections, each marked when it overlaps a block of another section. */
export const markedBlocks = (chosen: Course[]): { block: Block; clash: boolean }[] => {
  const blocks = chosen.flatMap(blocksOf);
  return blocks.map((block) => ({
    block,
    clash: blocks.some((other) => other.course.id !== block.course.id && blocksOverlap(block, other)),
  }));
};

/** A block placed in the day column: overlapping blocks sit side by side in lanes. */
export interface LaidBlock extends Block {
  clash: boolean;
  /** A preview of a section that isn't in the timetable yet */
  ghost?: boolean;
  lane: number;
  lanes: number;
}

/** Splits overlapping blocks of one day into side-by-side lanes. */
export const layoutDay = (items: { block: Block; clash: boolean; ghost?: boolean }[]): LaidBlock[] => {
  const sorted = [...items].sort((a, b) => a.block.start - b.block.start || a.block.end - b.block.end);
  const out: LaidBlock[] = [];
  let cluster: LaidBlock[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];

  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    cluster.forEach((it) => (it.lanes = lanes));
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };

  for (const { block, clash, ghost } of sorted) {
    if (cluster.length > 0 && block.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= block.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.end);
    } else {
      laneEnds[lane] = block.end;
    }
    cluster.push({ ...block, clash, ghost, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, block.end);
  }
  if (cluster.length) flush();
  return out;
};

/** Two chosen sections that meet at the same time, and when. */
export interface ClashPair {
  a: Course;
  b: Course;
  /** Each overlap: the day and the shared minutes, e.g. Wed 480–570 */
  overlaps: { day: string; start: number; end: number }[];
}

/** Every pair of chosen sections that clash, with the days and times they overlap. */
export const clashPairs = (chosen: Course[]): ClashPair[] => {
  const out: ClashPair[] = [];
  for (let i = 0; i < chosen.length; i++) {
    for (let j = i + 1; j < chosen.length; j++) {
      const overlaps: ClashPair['overlaps'] = [];
      for (const x of blocksOf(chosen[i])) {
        for (const y of blocksOf(chosen[j])) {
          if (blocksOverlap(x, y)) {
            overlaps.push({ day: x.day, start: Math.max(x.start, y.start), end: Math.min(x.end, y.end) });
          }
        }
      }
      if (overlaps.length) out.push({ a: chosen[i], b: chosen[j], overlaps });
    }
  }
  return out;
};

/** Courses whose final exams fall in the same exam period. */
export interface ExamClash {
  /** The period as the portal gives it, e.g. "3" */
  period: string;
  /** One section per course (different course codes) */
  courses: Course[];
}

/** Exam periods shared by two or more different courses in the timetable. */
export const examClashes = (chosen: Course[]): ExamClash[] => {
  const byPeriod = new Map<string, Map<string, Course>>();
  for (const c of chosen) {
    const period = c.finalExam?.date?.trim();
    if (!period) continue;
    const courses = byPeriod.get(period) ?? new Map<string, Course>();
    if (!courses.has(c.code)) courses.set(c.code, c);
    byPeriod.set(period, courses);
  }
  return [...byPeriod]
    .filter(([, courses]) => courses.size > 1)
    .map(([period, courses]) => ({ period, courses: [...courses.values()] }));
};

/** Course codes in the timetable that clash with another chosen course. */
export const clashingCodes = (chosen: Course[]): Set<string> => {
  const codes = new Set<string>();
  for (let i = 0; i < chosen.length; i++) {
    for (let j = i + 1; j < chosen.length; j++) {
      if (sectionsClash(chosen[i], chosen[j])) {
        codes.add(chosen[i].code);
        codes.add(chosen[j].code);
      }
    }
  }
  return codes;
};

/** Hour range for the grid: 08:00–16:00 by default, stretched to fit every block. */
export const gridHours = (courses: Course[]): { from: number; to: number } => {
  let from = 8;
  let to = 16;
  for (const b of courses.flatMap(blocksOf)) {
    if (!WEEK_DAYS.includes(b.day as (typeof WEEK_DAYS)[number])) continue;
    from = Math.min(from, Math.floor(b.start / 60));
    to = Math.max(to, Math.ceil(b.end / 60));
  }
  return { from, to };
};
