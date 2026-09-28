// Rollback re-simulation re-emits events: show each one once (CLAUDE.md §8, §12).
// `frame:type:who` catches an event re-emitted as is. A corrected timeline can also SHIFT an
// event by a frame or two (the remote's real stick input moved them a little, so our hit
// lands 1F later): the same type from the same fighter within ±2F of one already shown is
// that event again — without this it plays twice (double sparks, sound, damage number).
// Nothing legitimately repeats that fast (the closest are hits ≥16F apart, double steps ≥8F).
import { eventKey, type SimEvent } from '../core/events';

const SHIFT = 2;

export class EventFilter {
  private seen = new Map<string, number>();
  private shownAt = new Map<number, number>();

  /** Should this event be shown? `resim`: it came from a rollback re-simulation. */
  accept(e: SimEvent, resim: boolean): boolean {
    const k = eventKey(e);
    if (this.seen.has(k)) return false;
    this.seen.set(k, e.frame);
    const tw = e.type * 4 + e.who;
    const prev = this.shownAt.get(tw);
    if (resim && prev !== undefined && Math.abs(prev - e.frame) <= SHIFT) return false;
    this.shownAt.set(tw, e.frame);
    return true;
  }

  /** Forget keys older than `frame - 120` (called now and then). */
  prune(frame: number): void {
    if (this.seen.size <= 600) return;
    for (const [k, f] of this.seen) if (f < frame - 120) this.seen.delete(k);
  }
}
